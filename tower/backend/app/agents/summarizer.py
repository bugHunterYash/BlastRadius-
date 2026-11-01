"""Summarizer (local Ollama model): what each agent did in a run and why, plus answers to timeline questions.

It only ever sees compact event rows, including the one-line reason each agent gave. It runs
locally, so it costs nothing. When OLLAMA_MODEL is empty, or Ollama is down or returns bad JSON
twice, it falls back to a counted digest so the timeline is never blank.
"""

import asyncio
import json
import logging
import re
from collections import Counter

import httpx
from pydantic import BaseModel, ValidationError

from app.config import settings

log = logging.getLogger("tower.summarizer")
MAX_ROWS = 300


class AgentChanges(BaseModel):
    agent: str
    summary: str                  # what it did and why, one or two sentences


class Digest(BaseModel):
    headline: str                 # one sentence
    by_agent: list[AgentChanges]
    notable: list[str]            # e.g. "writer used price v1 after v2 existed"


class Answer(BaseModel):
    answer: str
    cited_times: list[str]


SYSTEM = ("You summarize what AI agents did to a shared memory and why. The rows are grouped under "
          "'== agent ==' headings. Each row is: time, agent, operation, fact and version, and sometimes "
          "'| why: ...' with the agent's own reason. For each agent, write one or two sentences saying what "
          "that agent did and why, using only the rows under its own heading. The headline is one sentence: "
          "what the run produced and, if problems are listed, the biggest one. Problems listed by the "
          "checkers are facts; do not add others. Never invent changes. Reply in JSON.")
ASK_SYSTEM = ("You answer questions about what AI agents did to a shared memory and why. Answer only "
              "from the rows given and cite the times (HH:MM) you used. If the rows don't answer the "
              "question, say so. Reply in JSON.")


def enabled() -> bool:
    return bool(settings.OLLAMA_MODEL)


def label() -> str:
    return f"ollama:{settings.OLLAMA_MODEL}" if enabled() else "fallback"


async def _generate(system: str, contents: str, schema: type[BaseModel]):
    """One chat call with a JSON-schema constrained reply. Retries once."""
    body = {
        "model": settings.OLLAMA_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": contents}],
        "format": schema.model_json_schema(),
        "stream": False,
        # small context + kept loaded: light on a laptop CPU (an i5 with integrated graphics is fine)
        "options": {"temperature": 0.2, "num_ctx": settings.OLLAMA_NUM_CTX},
        "keep_alive": settings.OLLAMA_KEEP_ALIVE,
    }
    last = None
    async with httpx.AsyncClient(base_url=settings.OLLAMA_URL, timeout=settings.OLLAMA_TIMEOUT_S) as client:
        for _ in range(2):
            try:
                r = await client.post("/api/chat", json=body)
                r.raise_for_status()
                return schema.model_validate_json(r.json()["message"]["content"])
            except (httpx.HTTPError, KeyError, ValidationError, json.JSONDecodeError, asyncio.TimeoutError) as exc:
                last = exc
    raise last


def fallback_digest(rows: list[str]) -> Digest:
    parts = [r.split() for r in rows]
    agents = Counter(p[1] for p in parts if len(p) > 2)
    ops = Counter(p[2] for p in parts if len(p) > 2)
    head = (f"{ops.get('WRITE', 0)} writes, {ops.get('READ', 0)} reads and {ops.get('HANDOFF', 0)} handoffs "
            f"by {len(agents)} agents.")
    by_agent = [AgentChanges(agent=a, summary=f"{n} memory operations") for a, n in agents.most_common()]
    return Digest(headline=head, by_agent=by_agent, notable=[])


_DENIES_PROBLEMS = re.compile(r"\b(no|without( any)?|zero|free of)\b[^.]{0,40}\b(issues?|problems?|errors?|bugs?)\b",
                              re.IGNORECASE)


def _guard_headline(headline: str, findings: list[str]) -> str:
    """The headline is what people read first, so it never rests on a small model's judgement:
    with detector findings it states them; otherwise the model's sentence is kept only if it is one."""
    if findings:
        n = len(findings)
        return f"Run finished with {n} detected issue{'s' if n > 1 else ''}: {findings[0]}"
    words = headline.split()
    title_like = headline.strip().lower().rstrip(".").endswith("summary") or headline.istitle()
    if len(words) < 6 or title_like or _DENIES_PROBLEMS.search(headline) is None and "issue" in headline.lower():
        return ""  # caller fills in a factual line
    return headline


def _facts_line(agent_rows: list[str]) -> str:
    """A plain sentence of what an agent did, built only from its rows (no model involved)."""
    writes, reads, handoffs, steps = [], [], [], 0
    for r in agent_rows:
        p = r.split()
        if len(p) < 3:
            continue
        op, rest = p[2], p[3:]
        if op == "WRITE" and rest:
            writes.append(" ".join(rest[:2]))
        elif op == "READ" and rest:
            reads.append(" ".join(rest[:2]))
        elif op == "HANDOFF" and len(rest) > 1:
            handoffs.append(rest[1])
        elif op == "EXEC":
            steps += 1
    parts = []
    if writes:
        parts.append("wrote " + ", ".join(dict.fromkeys(writes)))
    if reads:
        parts.append("read " + ", ".join(dict.fromkeys(reads)))
    if handoffs:
        parts.append("handed off to " + ", ".join(dict.fromkeys(handoffs)))
    if steps:
        parts.append(f"{steps} runtime step{'s' if steps > 1 else ''} (tasks, tools, commands)")
    return (parts[0][0].upper() + "; ".join(parts)[1:] + ".") if parts else "No recorded actions."


def _complete_agents(digest: dict, rows: list[str]) -> dict:
    """Small models skip agents or invent new ones. Keep the model's wording for agents that really
    acted, drop names that never appear in the rows, and add a factual line for anyone it skipped."""
    by_agent_rows: dict[str, list[str]] = {}
    for r in rows:
        p = r.split()
        if len(p) > 1 and p[1] != "system":
            by_agent_rows.setdefault(p[1], []).append(r)
    names = set(by_agent_rows)

    def own_words(agent: str, text: str) -> bool:
        """A line about one agent that names another one has mixed them up (common with tiny models)."""
        low = text.lower()
        return bool(text.strip()) and not any(re.search(rf"\b{re.escape(o)}\b", low) for o in names - {agent})

    written = {a["agent"]: a["summary"] for a in digest.get("by_agent", [])
               if a.get("agent") in by_agent_rows and own_words(a["agent"], a.get("summary", ""))}
    digest["by_agent"] = [{"agent": a, "summary": written.get(a) or _facts_line(rs)} for a, rs in by_agent_rows.items()]
    if not digest.get("headline"):
        agents = list(by_agent_rows)
        names = ", ".join(agents[:-1]) + (f" and {agents[-1]}" if len(agents) > 1 else (agents[0] if agents else ""))
        digest["headline"] = f"Clean run: {names} finished with no issues detected." if names else "No agent activity."
    return digest


def _grouped(rows: list[str]) -> str:
    """Rows under one heading per agent, so a small model attributes each action to the right agent."""
    by: dict[str, list[str]] = {}
    for r in rows:
        parts = r.split()
        by.setdefault(parts[1] if len(parts) > 1 else "?", []).append(r)
    return "\n\n".join(f"== {a} ==\n" + "\n".join(rs) for a, rs in by.items())


async def summarize_run(rows: list[str], findings: list[str] | None = None) -> tuple[dict, str]:
    """Returns (digest, model). `findings` are the detectors' one-line issues: they become the
    digest's notable list as-is, so the model never decides what went wrong. Long runs are
    summarized in chunks, then merged."""
    findings = findings or []
    problems = ("\n\nProblems found by the checkers:\n" + "\n".join(f"- {f}" for f in findings)) if findings else ""
    if not rows:
        return Digest(headline="No memory changes in this run.", by_agent=[], notable=[]).model_dump(), "fallback"
    if not enabled():
        return {**fallback_digest(rows).model_dump(), "notable": findings}, "fallback"
    try:
        if len(rows) <= MAX_ROWS:
            digest = await _generate(SYSTEM, _grouped(rows) + problems, Digest)
        else:
            parts = [await _generate(SYSTEM, _grouped(rows[i:i + MAX_ROWS]) + problems, Digest)
                     for i in range(0, len(rows), MAX_ROWS)]
            merged = [f"chunk {i + 1}: {p.headline} | " + " | ".join(a.summary for a in p.by_agent)
                      for i, p in enumerate(parts)]
            digest = await _generate(SYSTEM + " Merge these chunk summaries into one digest.", "\n".join(merged), Digest)
        out = {**digest.model_dump(), "headline": _guard_headline(digest.headline, findings), "notable": findings}
        return _complete_agents(out, rows), label()
    except Exception as exc:
        log.warning("summarizer fell back: %r", exc)
        return {**fallback_digest(rows).model_dump(), "notable": findings}, "fallback"


async def answer(question: str, rows: list[str]) -> dict:
    if not rows:
        return {"answer": "No changes match that filter.", "cited_times": [], "model": "none"}
    rows = rows[-MAX_ROWS:]
    if enabled():
        try:
            a = await _generate(ASK_SYSTEM, f"Question: {question}\n\nRows:\n" + "\n".join(rows), Answer)
            return {**a.model_dump(), "model": label()}
        except Exception as exc:
            log.warning("ask fell back: %r", exc)
    shown = rows[-10:]
    return {
        "answer": f"The summarizer model is off or unreachable, so here are the {len(shown)} latest of "
                  f"{len(rows)} matching changes:\n" + "\n".join(shown),
        "cited_times": [r.split()[0][:5] for r in shown],
        "model": "fallback",
    }
