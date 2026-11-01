# Demo video: Agent Control Tower (max 5 minutes)

What the video must show:
- **Track A:** the same flow with Meko **on** and **off**.
- **Track B:** the swarm view.

One 5-minute video covers both. If you enter only one track, drop the other section and slow down the one you keep.

---

## 1. What Meko does here, and what works without it

**Meko** (by Yugabyte) is the team's shared memory, reached over MCP at `mcp.mekodata.ai`. The tower is the
control room on top of it: it decides what each agent reads and writes, records every call with its version,
and catches mistakes.

### The Meko switch

The top bar has a **Meko on / off** switch. It applies to new tasks (project parts, chat questions,
"Assign work"), and each project run records which mode it ran in: its header and its report show a badge,
**Meko on** or **Meko off · agents alone**.

| | Meko OFF (agents alone) | Meko ON (shared memory) |
|---|---|---|
| Researcher's findings | Stay in its own answer | Saved to Meko (`memory_add`) as the fact `facts`, with a version |
| Writer's prompt | Only its own task | Its task + "Shared memory from the agents before you: facts vN, by researcher", read back from Meko (`memory_get_by_id`) |
| Writer's answer | Has none of the facts; it guesses or says it has none | Uses the researcher's facts and names the version |
| Handoff | None | Researcher hands off to Writer |
| Memory graph | Agents with no lines | Facts in the middle, write / read / handoff lines |
| Report → memory calls | 0 | counted (e.g. 4) |
| In Meko | Nothing new | The run's findings, searchable by any agent with the team's key |
| Notes typed in the chat, fix approvals | Kept in the local table | Written to Meko |

Without a Meko URL at all (`MEKO_MCP_URL` empty), "on" still shares memory, but only in a local table on this
machine; the switch then reads **Meko on · local**.

### What works the same either way (it doesn't need Meko)

- Running Claude Code, Codex and Antigravity agents, the chat and @tags, New project, Assign work
- Live sync of your app chats, allowed folders, hiding chats
- The detectors (stale read, conflict, skipped handoff, permission leak) on whatever memory events exist,
  the Ollama summary, fixes, the session report
- BlastX architecture map and "what breaks if Redis goes down"
- Google sign-in, landing page

---

## 2. Before you record (do this once, 30 minutes before)

1. Start everything: Docker (tower-pg, engine, demo stack), Ollama, then the API and the UI. Open
   `http://localhost:3100`. Close other heavy apps: the laptop has 8 GB.
2. Connect agents shows Claude, Codex and Antigravity signed in, and Meko connected.
3. Folders: `cbs` and `cbs final` are allowed, so the sidebar has real workspaces and no old-account chats.
4. **Record the agent runs ahead of time.** Real runs take 50 seconds to 2.5 minutes. Run each one once,
   then in the video open the finished run and only show the start live. Prepare:
   - **Run OFF** (already made on 1 Nov: "Aqua bottle launch (Meko off)"): switch **Meko off**, New project,
     Research (Codex) "Read pricing.md in your workspace and list the Aqua bottle's current price and 2 key
     facts", Draft (Claude) "Write a two-line launch blurb using only the facts the team already found. Say
     which facts you used. Do not open any files yourself.", "One after another" on.
   - **Run ON** (already made: "Aqua bottle launch (Meko on)"): the same, with **Meko on**.
   - Leave the switch **on** when you finish.
   - **Swarm run:** the 4-agent run "Aqua bottle full team check" (already exists), and `live-213526-a`
     (already exists, it has a real stale read caught by the detectors).
5. Browser zoom 90 to 100%, full screen, dark theme off, notifications off. Record at 1920x1080.
6. Have the Meko console open in a second tab (where the team's API key came from), so you can show the
   findings arriving in Meko. If you can't open it, use the dashboard's Shared memory instead.

---

## 3. The script (4:50)

Speak slowly. **Bold** = what to click. *Italic* = what to say.

### 0:00 to 0:20 · Hook
Screen: landing page, scroll once, click **TRY IT**.

*"Developers now run three AI coding agents on one project: Claude Code, Codex and Antigravity. But they
don't know what each other found. One fixes the price, another still uses the old one. Agent Control Tower
is a control room for that team, with Meko as their shared memory."*

### 0:20 to 0:45 · What's connected
Screen: dashboard. Click **Connect agents** in the sidebar.

*"These are real agents on their own logins: Claude Code, Codex with ChatGPT sign-in, and Antigravity with
Google. Meko is connected over MCP. And the tower only sees folders I allowed."* Point at **Folders: 2**.

### 0:45 to 1:40 · Track A, Meko OFF
Screen: click the **Meko** switch in the top bar so it reads **Meko off**. Open the run "Aqua bottle launch (Meko off)".

*"First, without Meko. The Researcher, on Codex, reads the pricing sheet and finds the price: Rs. 549."*
Scroll to the Researcher's answer.

*"See the badge: Meko off, agents alone. Then the Writer, on Claude, starts. It has only its own task. It never
sees what the Researcher found."*
Open the Writer's task, show the prompt has no facts. Show its answer (no price, or a guessed one).

*"The memory graph has nothing to show: no shared facts, no handoff. The report says zero memory calls.
That's how agents work today: each one alone."* Show the empty graph, then **View session report**, point
at memory calls = 0.

### 1:40 to 2:45 · Track A, Meko ON
Screen: click the switch back to **Meko on**. Open the run "Aqua bottle launch (Meko on)".

*"Now the same project with Meko on, same badge, now green. The Researcher's findings are written to Meko as
the fact `facts`, with a version."* Point at "wrote facts vN".

*"Before the Writer starts, the tower reads that fact back from Meko and hands it over. Here it is, in the
Writer's prompt: the facts, their version, by researcher."* Open the Writer's task, show the "Shared memory from the
agents before you" block.

*"The Writer uses exactly those facts and even says which version it used."* Show the answer naming the facts
it used.

*"And it's really in Meko, where any agent on the team can find it."* Switch to the Meko console tab (or the
dashboard's shared memory) and show the two entries for this run.

*"Report: every task done, the memory calls counted, and no coordination problems."* Open the report, point
at memory calls and "Delivered clean".

### 2:45 to 4:15 · Track B, the swarm view
Screen: open the run **Aqua bottle full team check**, graph panel wide (**Expand the graph**).

*"This is the swarm view: the whole team on one graph. Each circle is an agent, in its own colour:
Researcher on Codex, Writer and Reviewer on Claude, Analyst on Antigravity. The green squares are facts in
Meko. A solid line is a write, a dashed line is a read or a handoff."*

*"Facts v22 to draft v28 to review v18 to insights v1: four agents, three different AI products, one chain,
each reading the latest version."* Hover the lines.

Click **Replay**, press play. *"Replay plays the run step by step, so you can see who did what, and when."*

Open run **live-213526-a**. *"Now a run where something went wrong."* Point at the red line.
*"The Researcher updated the price to version 34, but the Writer read version 33. The tower caught it: a
stale read."* Click the issue. *"It shows why it's wrong and suggests a fix."*

Click **Trace** on price. *"Trace follows one fact through the swarm: who wrote it, who read which version."*
Point at the counters row and the activity strip. *"Every note, read, directive and tool call, counted
live."*

### 4:15 to 4:35 · BlastX, one line
Screen: **Architecture · BlastX**, click **demo-redis**.

*"And one tool inside: BlastX. Redis goes down, the API and worker break, Postgres keeps running, with
the fix for each."*

### 4:35 to 4:50 · Close
Screen: back to the dashboard.

*"Three AI agents, one shared memory in Meko, and one control tower that shows what they did and catches
their mistakes. Thank you."*

---

## 4. Recording tips

- Record each section as its own clip and join them. Cut the waiting while agents run.
- If a run goes wrong on the day, use the run you recorded before. Don't fake numbers: every number on
  screen is counted from the database.
- Keep the mouse still while talking. Zoom (Windows + Plus) into the prompt and the answer when you read
  them out.
- Check the total length before you upload: the limit is 5 minutes.
