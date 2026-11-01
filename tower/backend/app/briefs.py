"""Starting a project from the UI: a brief (name, goal, phases), a run, and each agent's part sent to it."""

import datetime as dt
import re

from app import db, execution, execution_db as xdb, projects
from app.runtime import router as agent_router
from app.runtime.models import InvokeRequest

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
            "Work only on your part. End with a short summary of what you did and anything the next agent needs.")


async def get(run_id: str) -> dict | None:
    r = await db.pool.fetchrow("SELECT * FROM project_briefs WHERE run_id = $1", run_id)
    return db._out(r) if r else None


async def start(*, name: str, kind: str, goal: str, deliverable: str | None, folder: str | None,
                tasks: list[dict], allow_edits: bool) -> dict:
    """Create the run and its brief, open the folder to the agents if one was given, and send every task."""
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
    sent = []
    for phase, t in zip(phases, tasks):
        inv, _ = await execution.submit(t["agent"], InvokeRequest(
            run_id=run_id, prompt=prompt_for(brief, phase["label"], t["task"]), why=f"{phase['label']} for {name}",
            workspace_id=workspace_id, read_only=not allow_edits))
        sent.append({"agent": t["agent"], "invocation_id": inv["invocation_id"], "phase": phase["label"]})
    return {**brief, "invocations": sent}


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
