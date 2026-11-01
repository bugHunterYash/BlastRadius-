import type { DesignSpec, Issue, MekoCall, MemoryEvent, PriorVersion, Run } from "./types"

// Sample run-42 from the integration guide: Researcher raises the price, Writer reads the old one,
// Publisher posts before the review. Replace with GET /v1/runs, /v1/runs/{id}/events and /v1/issues.

export const DESIGN: DesignSpec = {
  agents: ["researcher", "writer", "reviewer", "publisher"],
  handoffs: [["researcher", "writer"], ["writer", "reviewer"], ["reviewer", "publisher"]],
  must_pass_through: { publisher: ["reviewer"] },
  permissions: {
    researcher: { read: ["topic"], write: ["price", "facts"] },
    writer: { read: ["price", "facts"], write: ["draft"] },
    reviewer: { read: ["draft", "price", "facts"], write: ["review"] },
    publisher: { read: ["draft", "review"], write: ["published"] },
  },
}

/**
 * What the agents were building. The session report reads this to speak in the project's own terms:
 * its phases, what the deliverable is called, and which agent owns each phase.
 */
export type ProjectKind = "content" | "website" | "software" | "research" | "training" | "finetune" | "run"

export interface ProjectPhase {
  id: string
  label: string
  agent: string
}

export interface Project {
  name: string
  kind: ProjectKind
  goal: string
  deliverable: string
  phases: ProjectPhase[]
}

/** Default vocabulary per kind of project, used when a project doesn't spell out its own. */
export const PROJECT_TEMPLATES: Record<ProjectKind, { label: string; deliverable: string; phases: string[] }> = {
  content: { label: "Content pipeline", deliverable: "post", phases: ["Research", "Draft", "Review", "Publish"] },
  website: { label: "Website build", deliverable: "site", phases: ["Design", "Build", "Test", "Deploy"] },
  software: { label: "Software change", deliverable: "change", phases: ["Research", "Plan", "Review", "Ship"] },
  research: { label: "Research", deliverable: "findings", phases: ["Gather", "Analyse", "Review", "Report"] },
  run: { label: "Agent run", deliverable: "work", phases: [] },
  training: { label: "Agent training", deliverable: "agent", phases: ["Collect data", "Train", "Evaluate", "Ship"] },
  finetune: { label: "Model fine-tune", deliverable: "model", phases: ["Prepare data", "Fine-tune", "Evaluate", "Release"] },
}

export const PROJECT: Project = {
  name: "Aurora X1 launch post",
  kind: "content",
  goal: "Research the Aurora X1 headphones, write the launch post, review it and publish it.",
  deliverable: "launch post",
  phases: [
    { id: "research", label: "Research", agent: "researcher" },
    { id: "draft", label: "Draft", agent: "writer" },
    { id: "review", label: "Review", agent: "reviewer" },
    { id: "publish", label: "Publish", agent: "publisher" },
  ],
}

export const AGENT_ROLES: Record<string, string> = {
  researcher: "Finds facts and prices for the launch.",
  writer: "Writes the launch post from the facts.",
  reviewer: "Checks the draft against the facts.",
  publisher: "Publishes the approved post.",
}

type Row = [time: string, agent: string, op: MemoryEvent["op"], fact?: string, version?: number, value?: string, target?: string]

const ROWS: Row[] = [
  ["17:00:12", "researcher", "read", "topic", 1, "Aurora X1 headphones launch"],
  ["17:00:40", "researcher", "write", "price", 1, "₹499"],
  ["17:01:05", "researcher", "write", "facts", 1, "40h battery, ANC, 3 colours"],
  ["17:01:30", "researcher", "handoff", undefined, undefined, undefined, "writer"],
  ["17:02:11", "researcher", "write", "price", 2, "₹549"],
  ["17:04:03", "writer", "read", "price", 1, "₹499"],
  ["17:04:20", "writer", "read", "facts", 1, "40h battery, ANC, 3 colours"],
  ["17:05:40", "writer", "write", "draft", 1, "Launch post at ₹499"],
  ["17:06:02", "writer", "handoff", undefined, undefined, undefined, "reviewer"],
  ["17:06:30", "reviewer", "read", "draft", 1, "Launch post at ₹499"],
  ["17:06:41", "reviewer", "read", "price", 2, "₹549"],
  ["17:07:55", "reviewer", "write", "review", 1, "Price mismatch: draft says ₹499"],
  ["17:08:10", "publisher", "read", "draft", 1, "Launch post at ₹499"],
  ["17:08:12", "publisher", "read", "price", 2, "₹549"],
  ["17:08:30", "publisher", "write", "published", 1, "Aurora X1 is here. ₹499."],
]

export const EVENTS: MemoryEvent[] = ROWS.map(([time, agent, op, fact_key, version, value_preview, target_agent], i) => ({
  event_id: `ev${String(i + 1).padStart(2, "0")}`,
  run_id: "run-42",
  agent,
  op,
  fact_key,
  version,
  value_preview,
  target_agent,
  ts: `2026-10-31T${time}Z`,
}))

/** What each agent said when it made the call, as it shows in the shared chat. */
const SAID: Record<string, string> = {
  ev01: "Pulled the launch brief: Aurora X1 headphones.",
  ev02: "Price is ₹499.",
  ev03: "Specs saved: 40h battery, ANC, 3 colours.",
  ev04: "Facts are in. Over to you for the post.",
  ev05: "Price changed. It's ₹549 now.",
  ev06: "Using the price I have: ₹499.",
  ev07: "Got the specs.",
  ev08: "Draft ready: launch post at ₹499.",
  ev09: "Draft is up for review.",
  ev10: "Reading the draft.",
  ev11: "Latest price is ₹549.",
  ev12: "Mismatch: the draft says ₹499 but the price is ₹549.",
  ev13: "Picked up the draft.",
  ev14: "Checking the price before posting.",
  ev15: "Posted: “Aurora X1 is here. ₹499.”",
}

export const datapackOf = (agent: string) => `content-${agent}`

/** Every Meko call the run made, in order. Approvals and promotions are added live as people decide. */
export const CALLS: MekoCall[] = EVENTS.map((e) => ({
  call_id: `c-${e.event_id}`,
  ts: e.ts,
  actor: e.agent,
  kind: e.op === "write" ? "note" : e.op === "read" ? "recall" : "directive",
  // directives land in the recipient's datapack; notes and recalls use the agent's own
  datapack: datapackOf(e.op === "handoff" ? e.target_agent! : e.agent),
  to: e.target_agent,
  text: SAID[e.event_id] ?? "",
  event_id: e.event_id,
}))

export const PRIOR: PriorVersion[] = [
  { fact_key: "topic", version: 1, value_preview: "Aurora X1 headphones launch", agent: "planner", ts: "2026-10-31T16:40:00Z" },
]

export const ISSUES: Issue[] = [
  {
    issue_id: "7b1e",
    run_id: "run-42",
    type: "stale_read",
    agent: "writer",
    fact_key: "price",
    evidence: ["ev05", "ev08", "ev06"],
    status: "fix_ready",
    headline: "Writer used an old price",
    story: "Researcher updated the price to ₹549 at 17:02. Two minutes later Writer read the earlier ₹499 and wrote the draft with it.",
    fix: {
      fix_id: "c90a",
      explanation: "Writer should fetch every fact fresh when it starts, so it always works from the newest version.",
      fix_type: "handoff_rule",
      target_agent: "writer",
      before: "start when researcher hands off",
      after: "start when researcher hands off AND recall latest version of each fact",
      risk: "low",
      verify_by: "Writer reads price v2 on the next run.",
    },
  },
  {
    issue_id: "a3f0",
    run_id: "run-42",
    type: "permission_leak",
    agent: "publisher",
    fact_key: "price",
    evidence: ["ev14"],
    status: "fix_ready",
    headline: "Publisher read a fact it isn’t allowed to",
    story: "The design lets Publisher read only the draft and the review. At 17:08 it read price directly.",
    fix: {
      fix_id: "e21d",
      explanation: "Its prompt asks it to check the price. Taking the price from the review keeps it inside its permissions.",
      fix_type: "prompt",
      target_agent: "publisher",
      before: "Check the latest price before publishing.",
      after: "Use the price stated in the approved review. Do not read price directly.",
      risk: "low",
      verify_by: "Publisher makes no price reads on the next run.",
    },
  },
  {
    issue_id: "d41c",
    run_id: "run-42",
    type: "skipped_handoff",
    agent: "publisher",
    fact_key: "published",
    evidence: ["ev12", "ev15"],
    status: "open",
    headline: "Publisher went live before the review",
    story: "Reviewer flagged the wrong price at 17:07, but Publisher never got a handoff from Reviewer. It published at 17:08 anyway.",
    fix: null,
  },
]

/** The Fixer's answer for d41c, delivered over the stream a few seconds after load in this sample. */
export const LATE_FIX: { issue_id: string; fix: NonNullable<Issue["fix"]> } = {
  issue_id: "d41c",
  fix: {
    fix_id: "f77b",
    explanation: "Publisher starts as soon as a draft exists. Waiting for Reviewer’s handoff puts the review back in the path.",
    fix_type: "routing",
    target_agent: "publisher",
    before: "trigger on draft written",
    after: "trigger on handoff from reviewer",
    risk: "medium",
    verify_by: "Reviewer hands off to Publisher before anything is published.",
  },
}

export const RUNS: Run[] = [
  {
    run_id: "run-42",
    datapack: "content-team",
    status: "done",
    started_at: "2026-10-31T17:00:00Z",
    headline: "The post went live at the old price",
    summary: "Researcher raised the price from ₹499 to ₹549 at 17:02. Writer had already picked up ₹499, Reviewer caught the mismatch, and Publisher posted before the review reached it.",
  },
  {
    run_id: "run-41",
    datapack: "content-team",
    status: "done",
    started_at: "2026-10-31T15:22:00Z",
    headline: "A clean run",
    summary: "Every agent read the newest version of every fact, and nothing needed review.",
  },
  {
    run_id: "run-40",
    datapack: "content-team",
    status: "done",
    started_at: "2026-10-31T11:04:00Z",
    headline: "One fix, and it held",
    summary: "Writer read an old price. The handoff-rule fix was approved, and run-41 came back clean.",
  },
]

/** Where each node sits on the canvas (0–1 of a 1000×620 stage). */
export const LAYOUT: Record<string, { x: number; y: number }> = {
  researcher: { x: 0.13, y: 0.48 },
  writer: { x: 0.38, y: 0.38 },
  reviewer: { x: 0.63, y: 0.54 },
  publisher: { x: 0.88, y: 0.38 },
  topic: { x: 0.05, y: 0.1 },
  facts: { x: 0.16, y: 0.9 },
  price: { x: 0.37, y: 0.86 },
  draft: { x: 0.52, y: 0.06 },
  review: { x: 0.72, y: 0.92 },
  published: { x: 0.96, y: 0.82 },
}
