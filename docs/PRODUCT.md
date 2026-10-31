# BlastRadius: Product, Business Model, Use Cases, Install

Yeh doc batata hai ki BlastRadius ek **product** ke roop mein kaisa dikhega: kaun use karega, kaise install hoga, kya free hai, kya paid hai, aur paisa kaise banega.

Prototype images: [mockups/dashboard-simple.png](mockups/dashboard-simple.png) · [mockups/cli-simple.png](mockups/cli-simple.png) · [mockups/pricing.png](mockups/pricing.png)

> Hackathon mein hum **Free tier poora bana rahe hain** (₹0 cost par). Paid tiers ka pricing page aur roadmap dikhayenge. Neeche ke saare revenue numbers **assumptions** hain, data nahi.

---

## 1. Ek line mein

**"`npx blastx` chalao. 5 minute mein pata chalega ki aapki app ka kaunsa hissa tootega, kitne traffic par tootegi, aur fix kya hai, proof ke saath."**

---

## 2. Product ko simple rakhna (pehle complicated lag raha tha)

Rule: **user sirf 2 sawaal poochta hai**, baaki sab "Show details" ke peeche chhupa rahta hai.

| User ka sawaal | Command | Dashboard button |
|---|---|---|
| "Agar **X down** ho gaya to kya tootega?" | `blastx break redis` | **What if a service goes down?** |
| "App **kitna traffic** jhel sakti hai?" | `blastx load --up-to 10x` | **How much traffic can it handle?** |

**Answer hamesha plain language mein pehle aata hai:**

```
✕ Cart        breaks          91% of requests fail
! Checkout    partly broken   35% fail
✓ Products    fine            no real change
↻ Recovered 6.2s after redis came back
```

p-values, p99, buckets, preflight ki 9 checks: yeh sab ek click neeche **"Show evidence"** mein hain. Judges aur experts dekh sakte hain, naya user pareshaan nahi hota.

---

## 3. Use cases (asli log, asli sawaal)

### UC1 · Startup backend dev: "Sale se pehle"
**Riya**, ek 8 logon ki D2C startup mein backend dev hai. Diwali sale 2 hafte baad hai.
- `blastx load --up-to 10x` chalati hai.
- Result: **"Safe up to 100 rps (5×). 200 rps par checkout slow ho jaata hai (p95 742ms)."**
- `blastx ask "checkout slow kyun hua?"` se pata chalta hai ki DB connection pool chhota hai. Fix karke dobara test karti hai: ab 10× pass.
- **Value:** sale ke din outage nahi hota. Ek ghante ka downtime ek chhoti startup ke liye lakhon ka nuksaan ho sakta hai.

### UC2 · Student / hackathon team: "Demo se pehle"
**Arjun** ki team ka project Redis aur Postgres use karta hai.
- `blastx break redis` chalata hai aur pata chalta hai ki Redis girte hi poora login tootta hai.
- AI fix prompt: "session ko cache miss par DB se padho." Re-test karne par login chal jaata hai.
- **Value:** demo ke time koi surprise nahi aata. Yeh free hai, isliye students ka adoption aasaan hai.

### UC3 · Tech lead: "Har PR par resilience check" (Pro)
**Karan** chahta hai koi bhi PR resilience ko chupke se na tode.
- GitHub Action add karta hai: `uses: blastradius/action@v1` with `break: redis`.
- Agar kisi PR ke baad Redis girne par checkout tootne lage, to **PR fail** hota hai aur comment aata hai: "This PR made checkout depend on redis. Evidence: …"
- **Value:** reliability regression production tak nahi pahunchta. Yahi feature teams pay karti hain.

### UC4 · CTO / founder: "Proof chahiye" (Pro / Team)
Investor, enterprise client ya auditor poochta hai: *"Aapka DR/BCP test kab hua?"*
- **Shareable resilience report** (link + PDF): kya test hua, kya toota, recovery time kitna tha, fix ke baad ka before/after.
- **Value:** SOC 2 / ISO 27001 type audits mein disaster-recovery testing ka evidence lagta hai, aur yeh report usme kaam aati hai.

### UC5 · SRE: "Incident dobara reproduce karna"
Production mein Redis timeout se outage hua tha.
- Staging par `blastx break redis --mode latency=2s` chala kar same failure reproduce karta hai, fix verify karta hai, aur report postmortem mein attach karta hai.

---

## 4. Install aur setup (sab kuch)

### 4.1 Zaroorat kya hai
- **Docker Desktop** (ya Docker Engine). Aapki app already Docker Compose par hai, to yeh pehle se hai.
- **Node 18+**, sirf npm wala route use karna ho to.
- Python, k6, Postgres alag se install **nahi** karne padte. Sab engine ke andar aata hai.

### 4.2 Install

```bash
npm install -g blastx
```

Ya bina install kiye, ek baar try karne ke liye:

```bash
npx blastx init
```

Python users ke liye:

```bash
pipx install blastradius
```

**Andar kya hota hai:** `blastx` npm package ek chhota Node launcher hai. Pehli baar chalne par woh engine ki Docker image (`ghcr.io/bughunteryash/blastradius`) pull karta hai, jisme Python engine, k6, FastAPI API, dashboard aur Postgres sab hain. Aapke system par kuch aur install nahi hota. Hamari cost ₹0 rehti hai, kyunki run aapki machine par hota hai.

### 4.3 Pehle 5 minute

```bash
cd my-app
```

```bash
blastx init
```
- `docker-compose.yml` dhoondta hai aur services dikhata hai.
- Do sawaal poochta hai: *"Kaunse endpoints important hain?"* aur *"Kaunsi services todna OK hai?"*
- `blastx.yml` likhta hai, plus ek `docker-compose.blastx.yml` override jo safety labels lagata hai. **Aapki asli compose file touch nahi hoti.**

```bash
blastx up
```
- Engine aur dashboard start karta hai: **http://localhost:7777** (sirf aapki machine par, 127.0.0.1).

```bash
blastx break redis
```

```bash
blastx load --up-to 10x
```

### 4.4 Saare commands (sirf 8)

| Command | Kya karta hai |
|---|---|
| `blastx init` | Project setup, `blastx.yml` banata hai |
| `blastx up` / `blastx down` | Engine + dashboard start / stop (down sab restore bhi karta hai) |
| `blastx break <service>` | "Yeh service down ho to kya hoga?" |
| `blastx load --up-to 10x` | Breaking point dhoondta hai |
| `blastx ask "<sawaal>"` | AI agent se Hinglish/English mein poochho |
| `blastx fix [run]` | Evidence se AI fix prompt |
| `blastx report [run] --open` | Report browser mein kholta hai |
| `blastx status` | Kya chal raha hai, kya safe hai |

Advanced flags (`--baseline`, `--rps`, `--slo-p95`, `--mode latency=2s`…) `blastx help --all` mein hain. Naya user inhe dekhta hi nahi.

### 4.5 Config file (`blastx.yml`)

```yaml
app: demo-shop
compose: docker-compose.yml
endpoints:
  - GET /api/products
  - GET /api/cart
  - POST /api/checkout
slo:
  p95_ms: 500
  max_error_rate: 1%
safe_to_break: [redis, worker]
```

### 4.6 CI (Pro)

```yaml
# .github/workflows/resilience.yml
- uses: blastradius/action@v1
  with:
    break: redis
    load: 2x
    token: ${{ secrets.BLASTX_TOKEN }}
```

### 4.7 Uninstall

```bash
blastx down --purge
```

```bash
npm uninstall -g blastx
```

> **Naam ke baare mein:** `blastx` aur `blastradius` dono npm par abhi free hain (31 Oct 2026 ko check kiya). Dono ko placeholder publish karke abhi reserve kar lo, iski cost ₹0 hai. Ek dhyan rakhne wali baat: "BLASTX" bioinformatics (NCBI BLAST) mein ek mashhoor tool ka naam bhi hai, isliye Google search mein mix ho sakta hai. Brand **BlastRadius** rakho, command `blastx`.

---

## 5. Business model: open-core freemium

Model wahi hai jo Sentry, PostHog aur Grafana ka hai: **local tool free aur open source, team aur cloud features paid.**

### 5.1 Pricing

| | **Free** | **Pro** | **Team** | **Enterprise** |
|---|---|---|---|---|
| Price | ₹0 forever | **₹699 / dev / month** (~$9) | **₹3,999 / month**, 10 devs tak (~$49) | Custom (₹2L+/year) |
| Kiske liye | Students, solo devs | Serious indie devs, freelancers | Startups, product teams | Badi companies |
| Local CLI + dashboard | ✓ | ✓ | ✓ | ✓ |
| Fault + load tests | ✓ unlimited local | ✓ | ✓ | ✓ |
| AI agent | Apni Gemini key laao | ✓ built-in, 300 runs/month | ✓ 1,500 runs/month | ✓ unlimited / on-prem LLM |
| Report history | Local only | Cloud, 90 days | Cloud, 1 year | Custom retention |
| Shareable report link + PDF | | ✓ | ✓ | ✓ |
| GitHub Action PR gate | | ✓ | ✓ | ✓ |
| Scheduled nightly runs + Slack/Discord alerts | | ✓ | ✓ | ✓ |
| Remote staging (Docker over SSH) | | | ✓ | ✓ |
| Shared workspace, roles, audit log | | | ✓ | ✓ |
| Compare runs across branches/PRs | | | ✓ | ✓ |
| SSO/SAML, self-hosted, compliance evidence pack | | | | ✓ |
| Kubernetes support | | | | roadmap |

**Add-ons:**
- **Resilience Audit (service), ₹25,000–50,000 one-time:** hum startup ki app par poora audit chalate hain (launch, fundraise ya bade client se pehle) aur report + fix list dete hain. Pehli revenue yahin se aayegi, product poora bane usse pehle bhi.
- **Education:** colleges aur hackathons ke liye Pro free. Yeh adoption funnel hai.

### 5.2 Log paise kyun denge (free kaafi kyun nahi)
- **Free = ek insaan, ek laptop.** Team ko history, sharing, CI gate aur alerts chahiye. Yeh cloud features hain, aur inke liye log pay karte hain.
- **Proof bechne layak hai.** Shareable report audit aur clients ke kaam aati hai. Free mein local HTML milta hai, Pro mein branded link + PDF.
- **AI bina setup ke:** Free mein apni key lagani padti hai, Pro mein seedha kaam karta hai.

### 5.3 Unit economics (kyun margin achha hai)
- Test **customer ki machine ya unke CI par** chalta hai, hamare server par nahi. Hamari compute cost ≈ 0.
- Hamari cost sirf: report storage (kuch MB per user) + AI tokens (Gemini Flash class model) + hosting.
- Estimate: ek Pro user ki monthly cost kuch rupaye se lekar ₹50 tak, usage par depend karta hai. **Gross margin target 85%+.** (Final launch se pehle current Gemini pricing se verify karna hai.)

### 5.4 Competitors

| | Kya karte hain | Gap jo hum bharte hain |
|---|---|---|
| **Gremlin, Steadybit** | Enterprise chaos SaaS, sales-led, mehenga | Chhoti teams ke liye nahi; Docker Compose focus nahi; load + AI fix + proof ek jagah nahi |
| **AWS FIS** | AWS ke andar fault injection, pay per use | Sirf AWS; local/Compose par nahi chalta |
| **LitmusChaos, Chaos Mesh** | Free, open source | Sirf Kubernetes; load testing aur AI nahi; setup bhaari |
| **k6 / Grafana Cloud** | Load testing | Faults nahi todta; "kya toota aur kyun" nahi batata |
| **BlastRadius** | Fault + load + statistical proof + AI fix + re-test, ek command mein | Compose wali teams ke liye, free local, ₹699 se team features |

### 5.5 Go-to-market
1. **Open source on GitHub.** `npx blastx` ek line ka try, README mein GIF.
2. **Students aur hackathons:** free Pro. Aaj ke students kal ki startup teams hain.
3. **Content:** "Humne 20 open-source Docker apps tode, yeh mila" type blog/Reddit/X posts.
4. **GitHub Marketplace** par Action: discoverability + Pro conversion.
5. **Incubators/accelerators** ke saath partnership: portfolio startups ke liye Resilience Audit.

### 5.6 Revenue example (sirf assumptions, Year 1)

| Source | Assumption | Saal ka |
|---|---|---|
| Pro | 5,000 free installs, 3% convert = 150 devs × ₹699 × 12 | ≈ ₹12.6L |
| Team | 10 teams × ₹3,999 × 12 | ≈ ₹4.8L |
| Audits | 4 × ₹40,000 | ≈ ₹1.6L |
| **Total** | | **≈ ₹19L** |

Yeh pitch ke liye illustrative hai. Asli numbers launch ke baad conversion data se aayenge.

---

## 6. Hackathon mein kya dikhayenge

| Cheez | 24h mein | Kaise dikhega |
|---|---|---|
| Free tier: CLI + dashboard + AI agent + fault + load | **Banega, live** | Demo |
| `npm install -g blastx` launcher | Banega (Node launcher, ~2–3 ghante, Yash) | Demo ka pehla step |
| Shareable report | Local HTML export (banega) | "Pro mein yeh link ban jaata hai" |
| Pricing page | Static page dashboard mein | Screenshot / tab |
| GitHub Action, cloud history, billing | **Roadmap** | Slide, imaandari se "next" bolo |

> **Team ke liye note:** PRD mein CLI ka naam `br` hai. Is doc ke hisaab se user-facing command `blastx` hoga (`br` alias rakh sakte hain). Dashboard port 7777. Yeh decision PRD aur TASKS mein update karna baaki hai.
