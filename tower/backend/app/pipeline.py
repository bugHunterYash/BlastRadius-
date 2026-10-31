"""Per-run analysis: detectors -> verify earlier fixes -> summarizer -> fixer, streaming each result.

An asyncio.Queue is enough for one process; a job queue (e.g. ARQ with Redis) can replace it
later without changing the steps. Re-running analyse() on the same run is safe.
"""

import asyncio
import logging
import uuid

from app import agent_config, db, execution_db as xdb, stream
from app.agents import fixer, summarizer
from app.detectors import DETECTORS

log = logging.getLogger("tower.pipeline")
queue: asyncio.Queue[str] | None = None
fix_slots: asyncio.Semaphore | None = None


def start() -> asyncio.Task:
    """Create the queue on the running event loop and start the worker (called from the app lifespan)."""
    global queue, fix_slots
    queue, fix_slots = asyncio.Queue(), asyncio.Semaphore(3)
    return asyncio.create_task(worker())


def enqueue(run_id: str) -> None:
    queue.put_nowait(run_id)


async def worker():
    while True:
        run_id = await queue.get()
        try:
            await analyse(run_id)
        except Exception as exc:
            log.exception("analysis failed for %s", run_id)
            await db.set_run_status(run_id, "error")
            await stream.publish("run.status", {"run_id": run_id, "status": "error", "detail": str(exc)})
        finally:
            queue.task_done()


async def analyse(run_id: str):
    await db.set_run_status(run_id, "analysing")
    await stream.publish("run.status", {"run_id": run_id, "status": "analysing"})
    events, design, prior, scenario = await db.load_run_context(run_id)

    drafts = [d for detect in DETECTORS for d in detect(events, design, prior)]
    issues = await db.insert_issues(run_id, drafts)              # skips duplicates
    for issue in issues:
        await stream.publish("issue.created", issue)
    for issue in await db.verify_approved(run_id, scenario, drafts):
        await stream.publish("issue.updated", issue)

    # Memory rows and runtime execution rows (commands, files, tools), merged in time order.
    # run_start/run_end are bookkeeping, not agent work: keep them out of the model's input
    agent_events = [e for e in events if e.op not in ("run_start", "run_end")]
    rows = sorted(db.as_rows(agent_events) + await xdb.summary_rows(run_id))
    digest, model = await summarizer.summarize_run(rows, [d.detail for d in drafts])
    digest["execution_summary"] = await xdb.execution_summary(run_id)   # counted, never LLM-written
    await stream.publish("digest.created", await db.insert_digest(run_id, digest, model))

    async def fix_one(issue):
        async with fix_slots:
            full = await db.get_issue(uuid.UUID(issue["issue_id"]))
            invocations = await xdb.invocations_for_issue(uuid.UUID(issue["issue_id"]))
            execution = [f"{i['agent_id']} ran on {i['provider']} ({i['status']}); task: {i['prompt'][:300]!r}; "
                         f"answer: {(i['response'] or '')[:300]!r}" for i in invocations]
            execution += await xdb.recent_actions([i["invocation_id"] for i in invocations])
            try:
                proposal, model = await fixer.propose_fix(
                    full, design, full["evidence"], db.as_rows(full["evidence"]), await db.past_fixes(issue["type"]),
                    execution,
                )
            except agent_config.FixRejected as exc:
                note = f"fix dropped: {exc}"
                log.warning("%s %s", issue["issue_id"], note)
                await db.set_issue_note(issue["issue_id"], note)
                await stream.publish("issue.updated", {**issue, "note": note})
                return
            await stream.publish("fix.ready", await db.insert_fix(issue, proposal, model))

    await asyncio.gather(*(fix_one(i) for i in issues))
    await db.set_run_status(run_id, "done")
    await stream.publish("run.status", {"run_id": run_id, "status": "done"})
