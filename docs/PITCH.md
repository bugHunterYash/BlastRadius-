# BlastRadius: Judges ke liye pitch (5 min, Hinglish)

Pitch ka order judging criteria ke hisaab se hai: Problem & Value (10), Solution & Innovation (5), AI/Agent Engineering (5), Demo & Communication (5).

Prototype images: [docs/mockups/](mockups/). Web dashboard: `dashboard.png`. Terminal: `cli.png`.

> **Zaroori:** is doc ke saare numbers (91%, 5× / 100 rps, waghera) **sirf example** hain. Final demo se pehle real run karo aur wahi numbers bolo jo screen par "live" badge ke saath dikhein.

---

## 0:00–0:30 · Hook

> "Socho aapki app ka Redis raat ke 2 baje down ho jaata hai. Kya poori app down hogi? Ya sirf cart? Checkout chalega ya nahi? Aaj zyada tar teams ko yeh **production mein crash hone ke baad** pata chalta hai.
>
> Ya Diwali sale aati hai aur traffic 10 guna ho jaata hai. App kitne users tak chalegi aur kahan tootegi? Yeh bhi koi pehle se nahi jaanta.
>
> **BlastRadius yeh dono sawaal production se pehle, laptop par, safely answer karta hai. Proof ke saath.**"

## 0:30–1:15 · Problem (Problem & Value, 10 marks)

> "Problem teen hisson mein hai:
> 1. **Architecture diagram jhooth bolta hai.** Diagram mein likha hota hai 'API depends on Redis', par asal mein Redis girne par kya hota hai, woh kisi ne test nahi kiya hota.
> 2. **Chaos testing tools mehenge aur complex hain.** Gremlin jaise tools paid hain aur Kubernetes ke liye bane hain. Chhoti teams aur students ke paas Docker Compose hota hai, unke liye kuch nahi hai.
> 3. **Load testing ke numbers aksar galat hote hain.** Normal tools users ko 'wait' karwaate hain, isliye jab server slow hota hai to load bhi khud kam ho jaata hai aur latency asli se achhi dikhti hai.
>
> Result: outage pehli baar production mein dikhta hai, real users ke saamne."

## 1:15–2:00 · Solution: ek loop, paanch steps

> "BlastRadius ek **AI reliability agent** hai Docker Compose apps ke liye. Yeh paanch steps ka loop chalata hai:"

```
MAP  →  BREAK  →  MEASURE  →  FIX  →  PROVE
```

| Step | Kya hota hai (simple bhasha mein) |
|---|---|
| **MAP** | Aapki `docker-compose.yml` padh kar poora architecture graph banata hai: kaunsi service kis par depend karti hai |
| **BREAK** | Ek service ko jaan-boojh kar todta hai (jaise Redis stop), jabki uspar real synthetic traffic chal raha hota hai |
| **MEASURE** | Har second ka latency, error rate aur RPS measure karta hai, aur statistically prove karta hai ki asar asli hai, coincidence nahi |
| **FIX** | AI evidence dekh kar batata hai kya fix karo (timeout, fallback, retry, cache) |
| **PROVE** | Same test dobara chalata hai aur before/after dikhata hai ki fix ne kaam kiya ya nahi |

## 2:00–3:30 · Live demo (Demo & Communication, 5 marks)

### Demo 1: "Redis down hoga to kya hoga?"

> "Main AI agent se poochta hoon: **'Redis mar gaya to kya hoga?'**"

1. **Agent graph padhta hai** aur bolta hai: *"Config ke hisaab se `api` Redis par depend karta hai. Yeh **predicted** hai, abhi **verified** nahi."*
2. **Agent experiment plan karta hai:** 20 rps traffic, 30s baseline, phir Redis stop, phir recovery. Preflight ke 9 safety checks dikhte hain.
3. **Kuch bhi apne aap nahi chalta.** Main **Confirm** dabata hoon, tabhi experiment shuru hota hai.
4. **Live dashboard:** charts mein latency aur error rate upar jaate dikhte hain, aur Redis node "fault injected" ho jaata hai.
5. **`api` node "impact observed" tabhi hota hai jab evidence aata hai:**
   `/api/cart error rate 0.2% → 91% · n=412 · p<0.001`
6. **Report** mein hota hai: kya toota, kitna toota, aur recovery mein kitne seconds lage.
7. **AI fix prompt:** *"Redis call par 200ms timeout lagao aur cache miss par DB se fallback karo."* Fix lagane ke baad **same test dobara** chalta hai, before/after side by side.

> "Diagram ne bola tha 'shayad'. BlastRadius ne bola **'haan, aur yeh raha proof'**."

### Demo 2: "Kitne users par app tootegi?" (Traffic Twin, capacity test)

> "Ab doosra sawaal: app ka **breaking point** kya hai?"

- Baseline 20 rps rakhte hain, phir load steps: **1× → 2× → 5× → 10× → 20×** (yaani 20 → 40 → 100 → 200 → 400 requests/sec).
- Har step par SLO check hota hai: p95 latency < 500ms, error rate < 1%.
- Result card kuch aisa dikhega:
  > **"Highest load meeting all SLOs: 5× (100 rps) · First breach: 10× (p95 latency)"**
- Hum **k6 ka open model** use karte hain: naye users aate rehte hain chahe server slow ho, jaise real life mein hota hai. Isliye hamare numbers optimistic nahi, **honest** hote hain.

> **Judges ko imaandari se bolo:** demo laptop par chalta hai, isliye safety ke liye hard cap hai: max **500 requests/sec**, 200 virtual users, 5 minute. Yeh cap jaan-boojh kar rakha hai taaki tool galti se kisi ko DoS na kar de. Bade infra par yeh limit config se badhayi ja sakti hai, par default safe hai.

## 3:30–4:15 · System design aur AI architecture

```
   br CLI (terminal)        React Dashboard (browser)
          \                       /
           \                     /
            FastAPI control plane  (sirf 127.0.0.1, REST + live SSE)
                       |
     ┌─────────┬───────┼──────────┬──────────────┐
     │         │       │          │              │
  Compose   Safety   Fault      k6 Load       Gemini Agent
  parser +  preflight injector  generator     (9 typed tools)
  graph     (9 checks) (Docker)  (open model)        │
     │         │       │          │              │
     └─────────┴───────┴──── Analysis engine ────┘
                     (z-test, Mann-Whitney, recovery time)
                              │
                         PostgreSQL
              (experiments, evidence, reports, agent logs)
```

> "**AI yahan garnish nahi hai, agent hai** (AI/Agent Engineering, 5 marks):"

- **9 typed tools:** graph padhna, impact predict karna, evidence nikalna, do runs compare karna, experiment propose karna, abort propose karna.
- **Confirm gate:** agent khud kuch run nahi kar sakta, sirf propose karta hai. Insaan Confirm dabata hai.
- **Grounding verifier:** agent jo bhi number bole, woh tool se aaya hona chahiye. Number invent kiya to answer block ho jaata hai aur raw evidence table dikh jaati hai.
- **14 edge cases handle kiye:** API key nahi hai, rate limit (429), timeout, galat arguments, unsafe target (jaise production), prompt injection, hallucinated number, lock busy, plan expire, secrets redaction…
- **AI band ho to bhi tool chalta hai.** Gemini down ho to bhi CLI aur dashboard poore kaam karte hain.

## 4:15–4:45 · Safety aur zero cost

- Sirf woh containers tootenge jin par label ho `blastradius.env=test` aur `blastradius.fault-allowed=true`. Production markers dikhe to tool **refuse** karta hai.
- **Kill switch** har jagah hai: CLI mein Ctrl+C, dashboard mein Stop button.
- **Triple restore:** watchdog, `finally` block aur startup sweep. Crash ho jaaye to bhi service wapas aati hai.
- **₹0 cost:** Python, FastAPI, k6, Docker, PostgreSQL, React, sab open source. Gemini free tier.

## 4:45–5:00 · Close

> "Gremlin jaise tools hazaron dollar lete hain aur Kubernetes maangte hain. BlastRadius **free hai, laptop par chalta hai, aur har claim ke saath proof deta hai.**
>
> **Break it before production does.** Thank you!"

---

## Judges ke likely sawaal (Q&A prep)

| Sawaal | Jawab |
|---|---|
| "Yeh Chaos Monkey se alag kaise hai?" | Chaos Monkey sirf todta hai. Hum todte hain, traffic chalate hain, statistically measure karte hain, AI se fix suggest karte hain aur re-run se prove karte hain. Aur yeh Compose par chalta hai, Kubernetes nahi chahiye. |
| "AI hallucinate kare to?" | Grounding verifier: har number tool output se match hona chahiye, warna answer block ho jaata hai. Aur bina Confirm ke koi action nahi hota. |
| "Statistically significant kaise pata?" | Error rate ke liye two-proportion z-test, latency ke liye Mann-Whitney U. p < 0.01 **aur** minimum effect size dono chahiye. |
| "Real production par chala sakte ho?" | Nahi, aur yeh design se hai. Production markers dikhne par tool refuse karta hai. Yeh pre-production sandbox ke liye hai. |
| "500 rps se zyada?" | Laptop safety cap hai. Hamara goal "kitna bada load" nahi hai, balki "kahan tootega" honestly batana hai. Multiplier steps se breaking point milta hai. |
| "Business model?" | Open-source core free. Paid tier mein team dashboards, CI integration (har PR par resilience test) aur scheduled runs. |

## Speaking split

| Kaun | Kya bolega |
|---|---|
| Yash | Hook, problem, CLI demo |
| Harshit | Agent chat aur live charts |
| Sanchi | Architecture graph aur report / before-after |
| Ayush | AI architecture aur Q&A |
