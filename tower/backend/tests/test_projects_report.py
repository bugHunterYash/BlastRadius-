"""Starting a project from the UI, the report's data, BlastX, and the API token on every private route."""

import uuid

from tests.conftest import NO_TOKEN
from tests.test_execution import client, wait_terminal  # noqa: F401  (fixture)


def new_project(c, **extra):
    body = {"name": "Checkout revamp", "kind": "software", "goal": "Make checkout faster and safer.",
            "tasks": [{"agent": "researcher", "task": "Map the checkout services", "label": "Research"},
                      {"agent": "writer", "task": "Write the plan", "label": "Plan"}], **extra}
    return c.post("/v1/project-runs", json=body)


def test_new_project_creates_the_run_brief_and_tasks(client):  # noqa: F811
    r = new_project(client)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["run_id"].startswith("proj-checkout-revamp-") and p["deliverable"] == "change"
    assert [(x["agent"], x["phase"]) for x in p["invocations"]] == [("researcher", "Research"), ("writer", "Plan")]

    for x in p["invocations"]:
        wait_terminal(client, x["invocation_id"])
    inv = client.get(f"/v1/invocations/{p['invocations'][0]['invocation_id']}").json()
    assert "Project: Checkout revamp" in inv["user_prompt"] and "Your part (Research): Map the checkout services" in inv["user_prompt"]
    assert inv["routing"]["permissions"] == {"read": True, "write": False, "execute": False}       # read-only by default

    brief = client.get(f"/v1/runs/{p['run_id']}/brief").json()
    assert brief["goal"] == "Make checkout faster and safer." and [ph["agent"] for ph in brief["phases"]] == ["researcher", "writer"]
    assert any(run["run_id"] == p["run_id"] for run in client.get("/v1/runs").json())

    rep = client.get(f"/v1/runs/{p['run_id']}/report").json()
    assert rep["brief"]["name"] == "Checkout revamp" and rep["summary"]["total_invocations"] == 2
    row = rep["invocations"][0]
    assert row["agent_id"] == "researcher" and row["status"] == "completed" and row["commands"] >= 1
    assert row["final_response"] and row["input_tokens"] == 120


def test_in_order_parts_share_memory_and_the_run_is_analysed(client):  # noqa: F811
    import time
    p = new_project(client, in_order=True).json()
    assert [x["agent"] for x in p["invocations"]] == ["researcher"] and p["queued"] == [{"agent": "writer", "phase": "Plan"}]

    end = time.monotonic() + 30
    while client.get(f"/v1/runs/{p['run_id']}").json()["status"] != "done":
        assert time.monotonic() < end, "the run was never analysed"
        time.sleep(0.2)
    events = client.get(f"/v1/runs/{p['run_id']}/events").json()
    ops = [(e["agent"], e["op"], e["fact_key"] or e["target_agent"]) for e in events]
    assert ops == [("system", "run_start", None), ("researcher", "write", "facts"), ("researcher", "handoff", "writer"),
                   ("writer", "read", "facts"), ("writer", "write", "draft"), ("system", "run_end", None)]
    read = next(e for e in events if e["op"] == "read")
    assert read["version"] == next(e["version"] for e in events if e["op"] == "write") and read["invocation_id"]

    # the writer was given the researcher's findings, and they are in the shared notebook
    writer = next(i for i in client.get(f"/v1/runs/{p['run_id']}/invocations").json()["invocations"] if i["agent_id"] == "writer")
    assert "Shared memory from the agents before you" in client.get(f"/v1/invocations/{writer['invocation_id']}").json()["user_prompt"]
    assert any(f"[{p['run_id']}] researcher wrote facts" in n["text"] for n in client.get("/v1/notebook").json())
    assert not client.get(f"/v1/issues?run_id={p['run_id']}").json()        # a clean hand-off: nothing to flag


def test_chat_questions_share_the_team_memory(client):  # noqa: F811
    import time
    run = "chat-2026-11-01"
    ask = lambda agent, text: client.post(f"/v1/agents/{agent}/invoke", json={"run_id": run, "prompt": text}).json()  # noqa: E731

    first = ask("researcher", "What does the Aqua bottle cost?")
    wait_terminal(client, first["invocation_id"])
    end = time.monotonic() + 10
    while not [e for e in client.get(f"/v1/runs/{run}/events").json() if e["op"] == "write"]:
        assert time.monotonic() < end, "the researcher's answer was never saved"
        time.sleep(0.1)

    second = ask("writer", "Write one line about the bottle.")
    wait_terminal(client, second["invocation_id"])
    prompt = client.get(f"/v1/invocations/{second['invocation_id']}").json()["user_prompt"]
    assert prompt.startswith("Write one line about the bottle.") and "## facts (v" in prompt and "by researcher" in prompt
    end = time.monotonic() + 10
    while len([e for e in client.get(f"/v1/runs/{run}/events").json() if e["op"] == "write"]) < 2:
        assert time.monotonic() < end, "the writer's answer was never saved"
        time.sleep(0.1)
    ops = [(e["agent"], e["op"], e["fact_key"]) for e in client.get(f"/v1/runs/{run}/events").json()]
    assert ops == [("researcher", "write", "facts"), ("writer", "read", "facts"), ("writer", "write", "draft")]
    # an agent the design doesn't know reads nothing and leaves no stray reads behind
    assert client.post("/v1/agents/ghost/invoke", json={"run_id": run, "prompt": "x"}).status_code == 404
    assert len(client.get(f"/v1/runs/{run}/events").json()) == 3


def test_new_project_refuses_unknown_agents_before_creating_anything(client):  # noqa: F811
    r = new_project(client, tasks=[{"agent": "ghost", "task": "Haunt"}])
    assert r.status_code == 404
    assert not [run for run in client.get("/v1/runs").json() if run["run_id"].startswith("proj-")]
    assert new_project(client, folder="C:/not/a/synced/folder").status_code == 422
    assert client.get("/v1/runs/nope/brief").status_code == 404


def test_private_routes_need_the_token(client):  # noqa: F811
    iid = uuid.uuid4()
    for path in ("/v1/runs", f"/v1/invocations/{iid}", f"/v1/invocations/{iid}/events", "/v1/runs/x/invocations",
                 "/v1/notebook", "/v1/stream", "/v1/issues", "/v1/design", "/v1/audit", "/v1/live/sessions",
                 "/v1/runs/x/report", "/v1/blastx/architecture"):
        assert client.get(path, headers=NO_TOKEN).status_code == 401, path
    assert client.post(f"/v1/fixes/{iid}/approve", json={"decided_by": "x"}, headers=NO_TOKEN).status_code == 401
    assert client.get("/v1/health", headers=NO_TOKEN).status_code == 200


def test_blastx_maps_the_demo_stack_and_reports_impact(client, monkeypatch):  # noqa: F811
    from app.routers import blastx
    calls = []

    async def engine(method, path, **kw):
        calls.append((method, path))
        if path == "/api/architecture/parse":
            assert "services" in kw["json"]["content"]
            return {"id": "05bbf2d6-1d48-4445-9271-b05608ff55e8", "nodes": [{"id": "demo-redis"}], "edges": []}
        return {"service": "demo-redis", "impact": {"impacted": [{"impacted_service": "demo-api", "via": ["demo-api"]}]}}
    monkeypatch.setattr(blastx, "_engine", engine)
    blastx._graphs.clear()

    a = client.get("/v1/blastx/architecture").json()
    assert a["source"] == "demo stack" and a["graph"]["nodes"] == [{"id": "demo-redis"}]
    client.get("/v1/blastx/architecture")
    assert [p for _, p in calls].count("/api/architecture/parse") == 1                 # parsed once, then cached
    imp = client.get(f"/v1/blastx/impact/{a['graph']['id']}/demo-redis").json()
    assert imp["impact"]["impacted"][0]["impacted_service"] == "demo-api"
    assert client.get(f"/v1/blastx/impact/{a['graph']['id']}/bad name!").status_code == 422
    assert client.get("/v1/blastx/impact/not-a-uuid/demo-redis").status_code == 422
    assert client.get("/v1/blastx/architecture?workspace_id=demo-workspace").status_code == 404   # no compose file there


def test_report_counts_cached_input_and_fills_the_default_model(client):  # noqa: F811
    import json
    import uuid
    from app import db
    p = new_project(client).json()
    for x in p["invocations"]:
        wait_terminal(client, x["invocation_id"])
    writer = next(x["invocation_id"] for x in p["invocations"] if x["agent"] == "writer")

    async def claude_style_usage():
        await db.pool.execute(
            "UPDATE agent_invocations SET model = NULL, input_tokens = 6, usage = $2 WHERE invocation_id = $1", uuid.UUID(writer),
            json.loads('{"input_tokens": 6, "cache_read_input_tokens": 66541, "cache_creation_input_tokens": 63383}'))
        await db.pool.execute(
            "UPDATE agent_execution_events SET payload = payload || '{\"model\": \"claude-test-model\"}' "
            "WHERE invocation_id = $1 AND event_type = 'session.started'", uuid.UUID(writer))
    client.portal.call(claude_style_usage)
    row = next(t for t in client.get(f"/v1/runs/{p['run_id']}/report").json()["invocations"] if t["invocation_id"] == writer)
    assert row["input_tokens"] == 6 + 66541 + 63383
    assert row["model"] == "claude-test-model"
