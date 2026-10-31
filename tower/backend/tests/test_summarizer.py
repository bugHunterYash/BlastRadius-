"""Summarizer: prompt rows carry each agent's reason; Ollama replies are schema-checked; failures fall back."""

import asyncio
import datetime as dt
import json

import httpx

from app import db
from app.agents import summarizer
from app.config import settings
from app.models import Ev

T = dt.datetime(2026, 10, 31, 17, 2, 11, tzinfo=dt.timezone.utc)
GOOD = {"headline": "Writer used an old price.", "by_agent": [{"agent": "writer", "summary": "Drafted the post."}],
        "notable": ["17:04 writer used price v1 after v2 existed"]}


def _fake_ollama(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(summarizer.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "qwen2.5:3b")


def test_rows_include_the_agents_reason():
    rows = db.as_rows([Ev("e1", "r", "writer", "read", "price", 1, None, None, T, "using the price from my notes")])
    assert rows == ["17:02:11  writer      READ       price v1  | why: using the price from my notes"]


def test_ollama_digest_is_parsed_and_sent_with_schema(monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": json.dumps(GOOD)}})

    _fake_ollama(monkeypatch, handler)
    finding = "writer read price v1 after v2 was written by researcher."
    digest, model = asyncio.run(summarizer.summarize_run(
        ["17:02:11  researcher  WRITE  price v2", "17:04:03  writer  READ  price v1"], [finding]))
    # The model's own "notable" is replaced by what the detectors found; the researcher, which the model
    # skipped, gets a factual line from its rows.
    assert digest["headline"] == f"Run finished with 1 detected issue: {finding}"
    assert digest["notable"] == [finding] and model == "ollama:qwen2.5:3b"
    assert digest["by_agent"] == [{"agent": "researcher", "summary": "Wrote price v2."},
                                  {"agent": "writer", "summary": "Drafted the post."}]
    prompt = seen["messages"][1]["content"]
    assert "== researcher ==" in prompt and "== writer ==" in prompt and finding in prompt
    assert seen["model"] == "qwen2.5:3b" and seen["stream"] is False
    assert seen["format"]["required"] == ["headline", "by_agent", "notable"]


def test_bad_json_twice_falls_back_to_counted_digest(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, json={"message": {"content": "not json"}})

    _fake_ollama(monkeypatch, handler)
    digest, model = asyncio.run(summarizer.summarize_run(["17:02:11  writer  WRITE  draft v1"]))
    assert model == "fallback" and len(calls) == 2
    assert digest["headline"].startswith("1 writes")


def test_ollama_down_falls_back(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("refused")

    _fake_ollama(monkeypatch, handler)
    a = asyncio.run(summarizer.answer("what changed?", ["17:02:11  writer  WRITE  draft v1"]))
    assert a["model"] == "fallback" and "17:02:11" in a["answer"]


def test_model_invented_problems_never_reach_the_digest(monkeypatch):
    invented = {**GOOD, "notable": ["writer deleted the database at 17:05"]}
    _fake_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": json.dumps(invented)}}))
    digest, _ = asyncio.run(summarizer.summarize_run(["17:02:11  writer  READ  price v2"], []))
    assert digest["notable"] == []          # no detector findings -> nothing notable, whatever the model said


def test_headline_cannot_deny_detected_issues(monkeypatch):
    denial = {**GOOD, "headline": "The run completed without any major issues detected."}
    _fake_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": json.dumps(denial)}}))
    finding = "writer read price v1 after v2 was written by researcher."
    digest, _ = asyncio.run(summarizer.summarize_run(["17:02:11  writer  READ  price v1"], [finding]))
    assert digest["headline"] == f"Run finished with 1 detected issue: {finding}"
    clean, _ = asyncio.run(summarizer.summarize_run(["17:02:11  writer  READ  price v2"], []))
    assert clean["headline"] == denial["headline"]          # with no findings the model's headline stands


def test_skipped_agents_are_filled_in_and_invented_ones_dropped(monkeypatch):
    reply = {"headline": "Run done.", "notable": [],
             "by_agent": [{"agent": "writer", "summary": "Wrote the draft."},
                          {"agent": "ghost", "summary": "Did things that never happened."}]}
    _fake_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": json.dumps(reply)}}))
    rows = ["17:00:00  system      RUN_START",
            "17:00:01  researcher  WRITE      price v1",
            "17:00:02  researcher  HANDOFF    -> writer",
            "17:00:03  writer      READ       price v1",
            "17:00:04  writer      EXEC       ran `cat pricing.md` exit=0",
            "17:00:05  writer      WRITE      draft v1"]
    digest, _ = asyncio.run(summarizer.summarize_run(rows, []))
    assert [a["agent"] for a in digest["by_agent"]] == ["researcher", "writer"]       # no ghost, no system
    assert digest["by_agent"][0]["summary"] == "Wrote price v1; handed off to writer."
    assert digest["by_agent"][1]["summary"] == "Wrote the draft."                    # the model's own words kept


def test_junk_headline_without_findings_is_replaced(monkeypatch):
    junk = {**GOOD, "headline": "Agent's Actions Summary"}
    _fake_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": json.dumps(junk)}}))
    digest, _ = asyncio.run(summarizer.summarize_run(["17:02:11  writer  WRITE  draft v1"], []))
    assert digest["headline"] == "Clean run: writer finished with no issues detected."


def test_line_that_mixes_up_agents_is_replaced(monkeypatch):
    mixed = {"headline": "The launch post was drafted and published today.", "notable": [],
             "by_agent": [{"agent": "writer", "summary": "Reads the draft from the publisher and writes a review."}]}
    _fake_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": json.dumps(mixed)}}))
    rows = ["17:00:01  writer      WRITE      draft v1", "17:00:02  publisher   READ       draft v1"]
    digest, _ = asyncio.run(summarizer.summarize_run(rows, []))
    assert digest["by_agent"][0] == {"agent": "writer", "summary": "Wrote draft v1."}
