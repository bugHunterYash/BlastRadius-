# Agent Control Tower: poori kahani (Hinglish script)

Yeh doc ek saath teen kaam karta hai: **pitch script** (judges ke saamne bolne ke liye), **simple
explainer** (naye teammate ya naye AI ko samjhane ke liye), aur **demo flow**. BlastRadius ka purana
5-minute pitch [PITCH.md](PITCH.md) mein hai; yeh doc poore product ka hai, jismein BlastX ek tool hai.

> **Zaroori:** is doc mein jo numbers hain woh 1 Nov 2026 ke **real run** se hain ("Aqua bottle launch
> readiness" project). Demo se pehle dobara run karo aur wahi numbers bolo jo screen par dikhein.

---

## 1. Hook (30 sec)

> "Aaj ek developer akela code nahi likhta. Uske saath Claude Code chal raha hai, Codex chal raha hai,
> Antigravity chal raha hai. Teen-teen AI agents ek hi project par kaam kar rahe hain.
>
> Par ek sawaal koi nahi poochta: **yeh agents ek doosre ko jaante bhi hain?** Researcher ne price
> update kiya, kya Writer ne naya price padha ya purana? Kisne kya kiya, kyun kiya, kis file ko chhua?
>
> **Agent Control Tower yeh sab ek jagah, live, dikhata hai. Aur galti hone se pehle pakadta hai.**"

## 2. Problem (1 min)

> "Problem teen hisson mein hai:
>
> 1. **Har agent apni duniya mein hai.** Claude ki chat Claude app mein, Codex ki Codex app mein,
>    Antigravity ki Antigravity mein. Poori team ka ek view kahin nahi hai.
> 2. **Shared memory hai to galtiyan bhi shared hain.** Ek agent ne fact update kiya, doosre ne purana
>    version padh liya (stale read). Do agents ne ek hi cheez alag-alag likh di (conflict). Kisi ne
>    review skip kar diya (skipped handoff). Yeh sab chupke se hota hai aur final output mein galat
>    cheez chali jaati hai.
> 3. **Agent ne kya kiya, kyun kiya, kitna kharcha hua, iska koi record nahi.** Na report, na audit,
>    na proof."

## 3. Solution (1 min)

> "Agent Control Tower ek **control room hai AI agents ki team ke liye**. Paanch kaam karta hai:"

| Kaam | Simple bhasha mein |
|---|---|
| **Connect** | Claude, Codex aur Antigravity ko unke apne login se jodta hai (Google / ChatGPT sign-in). Koi API key paste nahi karni. |
| **Live sync** | Aapki Claude app, Codex app aur Antigravity ki chats apne aap tower mein aa jaati hain, har 5 second mein, sirf naye steps. |
| **Assign** | "New project" mein goal likho aur har agent ko uska kaam do: Researcher research kare, Writer draft kare, Analyst risk dhundhe. Sab ek saath shuru. |
| **Watch & catch** | Har tool call, command, file change "why" ke saath record hota hai. Detectors stale read, conflict, skipped handoff aur permission leak pakadte hain, aur fix suggest karte hain. |
| **Report** | Run ke end mein professional report: kaun sa kaam hua, kya jawab aaya, kitne tokens, kitna time, kya galat hua. PDF download bhi. |

> "Aur ek tool hai **BlastX**: aapki Docker Compose architecture ka map banata hai aur dikhata hai
> ki agar Redis down ho gaya to kya-kya tootega."

## 4. Meko kya hai, aur hum use kyun karte hain

> "**Meko** Yugabyte ka product hai: AI agents ke liye shared memory. Socho ek team ki common notebook,
> jismein har agent likh sakta hai aur padh sakta hai."

- **Datapack:** ek team ki memory ka dabba. Saare agents ek datapack share karte hain, jaise hamara
  `content-team`.
- **MCP se baat:** Meko ek MCP server hai (`mcp.mekodata.ai/mcp`). MCP woh standard hai jisse AI agents
  tools use karte hain. Isliye koi bhi agent (Claude, Codex, Antigravity) Meko se baat kar sakta hai.
- **Tools:** `memory_add` (yaad rakho), `memory_search` (dhundho), `memory_promote` (private se shared
  mein bhejo), conversations, knowledge base, datapacks.
- **Tower Meko ke saath kya karta hai:** notes aur approvals Meko mein likhta hai, Meko se padhta hai,
  aur har memory call ko version ke saath track karta hai, taaki pata chale kisne kaunsa version padha.
  Isi se stale read pakda jaata hai.

> "Meko memory deta hai. **Tower us memory ka CCTV aur traffic police hai**: kaun kya padh raha hai,
> kya likh raha hai, aur kahan gadbad ho rahi hai."

## 5. YugabyteDB ka role

- **Meko Yugabyte ka product hai.** Unke blog ke hisaab se har memory read/write ek MCP endpoint se
  hota hai jiske peeche ek unified database hai, isliye har read/write ka audit trail milta hai.
  (Exact database detail Meko docs se confirm karke hi bolna.)
- **Hamara apna database (tower ka) PostgreSQL 16 hai.** YugabyteDB ka YSQL Postgres-compatible hai,
  matlab kal ko Yugabyte par jaana ho to sirf connection string badlegi, code nahi.
- Hackathon ke liye hum ne plain Postgres chuna kyunki laptop par halka hai aur setup simple hai.

## 6. Tech stack (ek nazar mein)

| Hissa | Kya use kiya | Kyun |
|---|---|---|
| Backend | **FastAPI** (Python), asyncpg, SSE (live stream) | Fast, async, live updates browser tak |
| Database | **PostgreSQL 16** (Docker) | Free, solid; Yugabyte-compatible |
| Shared memory | **Meko** over **MCP** | Agents ki common memory |
| Agents | **Claude Agent SDK**, **Codex App Server** (JSON-RPC), **Antigravity CLI** (`agy`) | Teeno ke official runtimes, unke apne login ke saath |
| Summary | **Ollama + qwen2.5:0.5b** (local) | Free, laptop par chalta hai (i5, 8 GB RAM), data bahar nahi jaata |
| Frontend | **Next.js 15**, React 19, Tailwind, shadcn, **React Flow** (graph), recharts | Live chat, memory graph, report charts |
| BlastX engine | BlastRadius engine (FastAPI) + Docker demo stack (API, Redis, Postgres, worker, frontend) | Architecture map aur failure impact |

## 7. Agents ki team (demo design)

| Agent | Runtime | Kaam |
|---|---|---|
| Researcher | Codex | Facts aur price dhundhta hai |
| Writer | Claude Code | Draft likhta hai |
| Reviewer | Claude Code | Review karta hai |
| Publisher | Codex | Publish karta hai |
| Analyst | Antigravity (Gemini) | Risk aur gaps dhundhta hai |

Chat mein `@writer @analyst yeh check karo` likho to ek hi message dono ko jaata hai, har ek apni
conversation mein.

## 8. BlastX: "Redis gaya to kya gaya?"

> "Architecture tab kholo. BlastX `docker-compose` file padh kar graph banata hai: frontend, API,
> Redis, Postgres, worker. Ab Redis ko 'fail' karo."

- Redis graph se **kat jaata hai** (✂ DOWN), uski saari lines cut.
- **API aur worker seedha toot-te hain**, frontend API ke through. **Postgres chalta rehta hai.**
- Har tootne wali service ke saath **kyun** (jaise `depends_on: service_healthy`, `REDIS_URL`) aur
  **fix** (timeout, retry, fallback, startup gate hatao).
- Neeche card: **"Prove it under real load" (Pro)**: sandbox mein sach mein Redis band karke, traffic
  chalate hue, errors aur latency measure karna.

## 9. Privacy aur security

> "Agents aapka code chhoote hain, isliye safety pehle:"

- Har API ke liye **token zaroori**; token browser tak kabhi nahi jaata (server-side proxy).
- UI sirf **localhost** par jawab deta hai; doosri website ya network ka koi aur machine use nahi kar sakta.
- **API keys aur passwords record hote hi chhupa diye jaate hain** (redaction).
- Agents sirf allowed folders mein chalte hain; project kaam **default read-only** hai.
- Aapki personal synced chats kabhi report mein nahi jaati. Sab data aapke laptop par rehta hai.

## 10. Business model

| Plan | Kya milta hai |
|---|---|
| **Free** | Agents connect, live sync, chat, shared memory view, detectors, session report, BlastX impact map |
| **Pro** | BlastX live chaos tests (real load ke saath), report history aur compare, team workspaces, auto-fix flows |

## 11. Demo flow (5 min)

1. **(0:30)** Sidebar: teen apps ki live sessions (Claude, Codex, Antigravity logos), "Live now" dot.
2. **(1:00)** **New project** → "Aqua bottle launch readiness": Researcher, Writer, Analyst ko kaam do → Start.
3. **(1:00)** Chat mein live steps: kaunsa command chala, kaunsi file padhi, aur **kyun**.
   Real run mein: Researcher ne Rs. 549 (pehle Rs. 499) aur 3 facts nikale, Writer ne 2-line blurb
   likha, Analyst ne bataya ki 31 Oct ka price change sabse bada risk hai.
4. **(1:00)** **Conclude session → Report**: 3/3 tasks done, ~51 sec, ~233k tokens, har agent ka
   kaam aur jawab. **Download PDF.**
5. **(1:00)** **Architecture · BlastX** tab → Redis fail karo → graph kat-ta hai → fixes → Pro card.
6. **(0:30)** Close: "Ek developer, teen AI agents, ek control tower."

## 12. Judges ke sawaal (Q&A prep)

- **"Yeh sirf ek wrapper hai?"** Nahi. Meko memory deta hai; hum teen alag runtimes ko unke official
  protocols se chalaate hain, unki live chats sync karte hain, memory ke versions track karke galtiyan
  pakadte hain, fix suggest karte hain aur report banate hain. Yeh memory ke upar ka control layer hai.
- **"Numbers AI ne banaye?"** Nahi. Report ka har number database se gina jaata hai. Local model
  (qwen) sirf summary likhta hai, aur us par bhi guards hain.
- **"Data cloud par jaata hai?"** Tower ka data laptop par Postgres mein hai. Bahar sirf woh jaata hai
  jo agents apne provider ko bhejte hain, aur Meko memory.
- **"Kharcha?"** Postgres, Ollama, Next.js, FastAPI sab free/open-source. Agents aapke existing
  subscriptions se chalte hain.
- **"Kya pending hai?"** (Imaandari se bolo) Agents ki findings abhi Meko mein auto-write nahi hoti, aur
  BlastX ka live load test (Pro) engine ke ek bug ki wajah se abhi report nahi bana pata.
