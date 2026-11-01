"""Starting a project from the UI: a brief (name, goal, phases), a run, and each agent's part sent to it.

Every part reads the shared memory before it starts and writes its findings after (app.team_memory).
In order, each part waits for the one before, so it reads that agent's findings; otherwise all start at once.
"""

import asyncio
import datetime as dt
import logging
import re

from app import db, execution, execution_db as xdb, meko_client, projects, team_memory
from app.runtime import router as agent_router
from app.runtime.models import InvokeRequest

log = logging.getLogger("tower.briefs")
_runs: set[asyncio.Task] = set()       # running project runs, kept so they aren't garbage-collected

KINDS = {
    "content": ("Content pipeline", "post"),
    "website": ("Website build", "site"),
    "software": ("Software change", "change"),
    "research": ("Research", "findings"),
    "training": ("Agent training", "agent"),
    "finetune": ("Model fine-tune", "model"),
}


def run_id_for(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "project"
    return f"proj-{slug}-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')}"


def prompt_for(brief: dict, label: str, task: str) -> str:
    return (f"Project: {brief['name']}\nGoal: {brief['goal']}\nYour part ({label}): {task}\n\n"
            "Work only on your part. End with a short summary of what you did and anything the next agent needs. "
            "The Control Tower saves your final answer to the team's shared memory and hands it to the next agent, "
            "so you don't need to hand off yourself.")


async def get(run_id: str) -> dict | None:
    r = await db.pool.fetchrow("SELECT * FROM project_briefs WHERE run_id = $1", run_id)
    return db._out(r) if r else None


async def start(*, name: str, kind: str, goal: str, deliverable: str | None, folder: str | None,
                tasks: list[dict], allow_edits: bool, in_order: bool = False) -> dict:
    """Create the run and its brief, open the folder to the agents if one was given, and send the tasks:
    all now, or (in_order) the first now and each next one when the one before has finished."""
    label, default_deliverable = KINDS[kind]
    workspace_id = (await projects.register(folder))["workspace_id"] if folder else None
    design = await db.get_design()
    for t in tasks:                      # every part must be routable before anything is created
        agent_router.resolve(t["agent"], design, workspace_id, read_only=not allow_edits)
    run_id = run_id_for(name)
    phases = [{"id": f"p{i + 1}", "label": t.get("label") or f"Part {i + 1}", "agent": t["agent"]} for i, t in enumerate(tasks)]
    brief = {"run_id": run_id, "name": name, "kind": kind, "kind_label": label, "goal": goal,
             "deliverable": deliverable or default_deliverable, "phases": phases, "workspace_id": workspace_id}
    async with db.transaction() as c:
        await xdb.ensure_run(c, run_id)
        await c.execute(
            "INSERT INTO project_briefs (run_id, name, kind, goal, deliverable, phases, workspace_id) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            run_id, name, kind, goal, brief["deliverable"], phases, workspace_id)
    memory = meko_client.mode()
    await db.pool.execute("UPDATE runs SET memory_mode = $2 WHERE run_id = $1", run_id, memory)
    await team_memory.emit(run_id, "system", "run_start", reason={
        "meko": "Shared memory on: agents read and write Meko", "local": "Shared memory on (local table, no Meko URL)",
        "off": "Meko off: each agent works alone"}[memory])

    async def send(i: int) -> dict:
        phase, t = phases[i], tasks[i]
        memory, reads = await team_memory.recall(run_id, t["agent"], design)
        inv, _ = await execution.submit(t["agent"], InvokeRequest(
            run_id=run_id, prompt=prompt_for(brief, phase["label"], t["task"]) + memory, why=f"{phase['label']} for {name}",
            workspace_id=workspace_id, read_only=not allow_edits))
        await team_memory.tie_reads(reads, inv["invocation_id"])
        return {"agent": t["agent"], "invocation_id": inv["invocation_id"], "phase": phase["label"]}

    async def finish(i: int, sent: dict) -> None:
        done = await execution.wait(sent["invocation_id"])
        if done and done["status"] == "completed" and done.get("final_response"):
            nxt = phases[i + 1]["agent"] if i + 1 < len(phases) else None
            await team_memory.remember(run_id, sent["agent"], done["final_response"], design,
                                       invocation_id=sent["invocation_id"], next_agent=nxt)

    first = [await send(0)] if in_order else [await send(i) for i in range(len(phases))]

    async def follow() -> None:
        try:
            if in_order:
                await finish(0, first[0])
                for i in range(1, len(phases)):
                    await finish(i, await send(i))
            else:
                await asyncio.gather(*(finish(i, s) for i, s in enumerate(first)))
        except Exception:
            log.exception("project run %s stopped early", run_id)
        await team_memory.emit(run_id, "system", "run_end")       # starts the analysis

    task = asyncio.create_task(follow())
    _runs.add(task)
    task.add_done_callback(_runs.discard)
    return {**brief, "in_order": in_order, "invocations": first,
            "queued": [{"agent": p["agent"], "phase": p["label"]} for p in phases[len(first):]]}


async def shutdown() -> None:
    """Stop following project runs when the server stops (their tasks are marked interrupted on the next start)."""
    for t in list(_runs):
        t.cancel()
    await asyncio.gather(*_runs, return_exceptions=True)


async def report_data(run_id: str) -> dict | None:
    """Everything the report shows about the agents' real work in a run, from the database."""
    run = await db.get_run(run_id)
    if run is None:
        return None
    rows = await db.pool.fetch(
        """SELECT i.invocation_id, i.agent_id, i.provider, i.runtime, i.status, i.workspace_id, i.why,
                  i.user_prompt, i.final_response, i.error_message, i.output_tokens,
                  -- the model the runtime actually used when the route left it to the provider's default
                  COALESCE(i.model, (SELECT s.payload->>'model' FROM agent_execution_events s
                                     WHERE s.invocation_id = i.invocation_id AND s.event_type = 'session.started'
                                     LIMIT 1)) AS model,
                  -- Claude reports cached input apart from new input; the report counts all of it
                  i.input_tokens + COALESCE((i.usage->>'cache_read_input_tokens')::int, 0)
                                 + COALESCE((i.usage->>'cache_creation_input_tokens')::int, 0) AS input_tokens,
                  i.created_at, i.started_at, i.completed_at,
                  count(e.*) FILTER (WHERE e.event_type = 'tool.started') AS tools,
                  count(e.*) FILTER (WHERE e.event_type = 'command.started') AS commands,
                  count(e.*) FILTER (WHERE e.event_type = 'file.changed') AS files,
                  count(e.*) FILTER (WHERE e.event_type = 'approval.requested') AS approvals,
                  count(e.*) FILTER (WHERE e.event_type = 'execution.error') AS errors
           FROM agent_invocations i LEFT JOIN agent_execution_events e ON e.invocation_id = i.invocation_id
           WHERE i.run_id = $1 GROUP BY i.invocation_id ORDER BY i.created_at""",
        run_id)
    return {"run": run, "brief": await get(run_id), "summary": await xdb.execution_summary(run_id),
            "invocations": [db._out(r) for r in rows]}
