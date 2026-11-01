# Prompt: deploy Agent Control Tower + BlastX for free

Copy everything below the line into a new AI coding session (Claude Code, opened in this repo) once you have the
server from **Part A**. Part A is for you (Yash): it needs your accounts and a card check, so an AI can't do it.

---

## Part A: what you do first (about 20 minutes)

1. **Oracle Cloud account** (free forever tier): sign up at cloud.oracle.com. It asks for a card to check you're
   real; the Always Free resources aren't charged. Pick home region **India West (Mumbai)** or **India South
   (Hyderabad)**. The home region can't be changed later.
2. **Create the server**: Compute → Instances → Create.
   - Image: **Ubuntu 24.04** (the normal one, not "Minimal").
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB RAM**. Reports say Oracle cut the free amount to
     2 OCPU / 12 GB in June 2026. If your console still offers 4 / 24 for free, you can take it, but 2 / 12 is
     enough.
   - Boot volume: 100 GB (free up to 200 GB in total).
   - Add your SSH public key (`ssh-keygen -t ed25519` on your laptop if you don't have one).
   - If it says **"Out of capacity"**, try again later or pick another availability domain. This is common.
3. **Open ports 80 and 443** in Oracle's network: Instance → Subnet → Security List → Add Ingress Rules:
   source `0.0.0.0/0`, TCP, ports `80` and `443`. Don't open anything else.
4. **Google sign-in client**: Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID →
   "Web application". Authorized redirect URI: `https://<server-ip-with-dashes>.sslip.io/api/auth/callback/google`
   (for IP `140.238.1.2` that's `https://140-238-1-2.sslip.io/api/auth/callback/google`). Keep the client ID and
   secret. Also add `http://localhost:3100/api/auth/callback/google` so local sign-in works too.
5. **Push the engine branch** from your laptop: in `C:\Users\F(x)ash\Documents\cbs final`, run
   `git push origin feat/yash-YA-08`. Don't include the teammates' uncommitted `Makefile` and
   `tests/integration/test_load_parity.py` changes.
6. Have these ready to paste when the AI asks (never paste them into a file that gets committed):
   the server IP, your Google client ID and secret, your Meko API key, and the Google emails allowed to sign in.

**Why Oracle:** it's the only free-forever host with enough memory for this stack. The BlastRadius engine
needs Docker on the machine (it stops and starts real containers), and the tower runs agent CLIs plus Ollama.
Render, Railway, Vercel and Fly free tiers can't do that, and Google's free VM has only 1 GB of RAM.

**Free-tier warnings:**
- Oracle may reclaim an Always Free instance that sits nearly idle (under about 20% CPU) for 7 days. Use it,
  or upgrade the account to Pay As You Go (Always Free resources stay free) to stop that.
- If the free trial ends while you're over the free limits, Oracle can stop the instances. Stay at or under
  2 OCPU / 12 GB.

**Plan B (no Oracle account):** run everything on your laptop as you do now and publish it with a free
Cloudflare Tunnel. See the last section of the prompt. The laptop has to stay on, and 8 GB is tight.

---

## Part B: the prompt for the AI

```text
You are deploying Agent Control Tower + BlastX to one free Oracle Cloud Ampere (ARM64) Ubuntu 24.04 server.
Repo: github.com/bugHunterYash/BlastRadius- (branch main). Engine: same GitHub repo, branch feat/yash-YA-08
(it has docker-compose.yml, demo-app/ and the engine Dockerfile). Read docs/HANDOFF.md and docs/DEPLOY.md
first; deploy/ already holds docker-compose.yml, Caddyfile, setup.sh, tower-api and tower-ui Dockerfiles.

Ground rules
- Ask me for every secret (Google client id/secret, Meko key, allowed emails) and write them only to
  /opt/blastx/tower/deploy/.env on the server (chmod 600). Never commit, print or log them.
- Commit and push only when I say so, on a new branch, never straight to main. End commit messages with
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>".
- Don't open any port except 22, 80, 443. The API (8010), Postgres, Ollama, the engine (8000) and the demo
  stack stay on the private Docker network or 127.0.0.1.
- Plain words in any UI text or docs you write.

Step 1: make the code ARM-ready (on a branch, in the repo)
1. Engine (branch feat/yash-YA-08, backend/Dockerfile): it downloads only k6-*-linux-amd64. Use Docker's
   TARGETARCH to pick linux-amd64 or linux-arm64 from the same k6 release, and check the archive against the
   SHA-256 published in that release's checksums file. Keep a pinned version and a strict checksum check.
   Build it on the server, run `k6 version` in the image, and open a PR into that branch.
2. deploy/tower-api.Dockerfile: confirm `npm install -g @openai/codex` and the Claude CLI bundled with
   claude-agent-sdk both run on linux/arm64 inside the image (`codex --version`, and a claude_agent_sdk import
   plus its bundled CLI `--version`). Fix only what fails.
3. Postgres, Ollama, Caddy and Node images are multi-arch already. Pull them once to confirm.

Step 2: make the public site work with Google sign-in
1. The landing page (/) must be public. /dashboard and /api/tower/* are protected by Google sign-in
   (frontend/src/middleware.ts, AUTH_REQUIRED is forced to "true" in deploy/docker-compose.yml).
2. deploy/Caddyfile puts basic_auth in front of everything, which also hides the landing page and adds a second
   login. Make basic_auth optional: on only when UI_PASSWORD_HASH is set. Default to off, because Google
   sign-in now guards the app. Keep HTTPS, the security headers and `flush_interval -1` (it keeps SSE live).
3. Make sure Next.js builds the right callback URLs behind Caddy: AUTH_URL=https://<domain> (already in the
   compose file) and trustHost: true (already in src/auth.ts). TOWER_ALLOWED_HOSTS=<domain>.
4. Update deploy/.env.example and setup.sh: UI_PASSWORD_HASH optional, ask for AUTH_GOOGLE_ID,
   AUTH_GOOGLE_SECRET and AUTH_ALLOWED_EMAILS, generate AUTH_SECRET (setup.sh already does this).

Step 3: prepare the server (ssh ubuntu@<ip>)
1. Oracle Ubuntu images block ports with their own iptables rules, even after the Security List allows them.
   Allow 80 and 443 in iptables and save the rules (netfilter-persistent), or the site won't load. Don't
   enable ufw at the same time as these rules without checking they agree; setup.sh enables ufw, so adapt it
   for Oracle (detect Oracle and use iptables, or make sure ufw and iptables both allow 22/80/443).
2. Add 4 GB swap (setup.sh does this). Install Docker with the official script. Add the ubuntu user to the
   docker group.
3. Domain: use <ip-with-dashes>.sslip.io (free; Caddy gets a real Let's Encrypt certificate for it).

Step 4: deploy
1. Run deploy/setup.sh with the domain. It clones the tower (main) and the engine (feat/yash-YA-08) into
   /opt/blastx, creates the br-target and br-control networks, starts the engine and demo stack bound to
   127.0.0.1, writes deploy/.env with random secrets, pulls qwen2.5:0.5b into Ollama, and starts the tower.
   Note: deploy/docker-compose.yml marks br-control as external, so the engine stack must create it first.
2. Fill MEKO_API_KEY, the Google values and AUTH_ALLOWED_EMAILS in deploy/.env, then
   `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.
3. Sign the agents in once (logins are kept in the agent-home volume):
   - Codex: `docker compose -f /opt/blastx/tower/deploy/docker-compose.yml exec -it tower-api codex login --device-auth`
     and give me the code to approve.
   - Claude: in the dashboard, Connect agents → Claude → Sign in; I open the link and paste the code back.
   - Antigravity stays off on the server (ANTIGRAVITY_RUNTIME_ENABLED=false, no Linux CLI in the image).
4. Live sync of my laptop's chats is off in the cloud (LIVE_SYNC_ENABLED=false). Leave it off.

Step 5: check that everything works, and show me the evidence
- https://<domain>/ shows the landing page over HTTPS with a valid certificate, with no basic-auth prompt.
- https://<domain>/dashboard sends a signed-out visitor to /login; signing in with an allowed Google account
  lands on the dashboard; a Google account NOT on AUTH_ALLOWED_EMAILS gets "isn't allowed".
- curl https://<domain>/api/tower/v1/runs without a session returns 401.
- From the internet, ports 8000, 8010, 5432 and 11434 are closed (nmap or `curl --max-time 5`).
- `docker compose ps`: every service is healthy. The engine answers on 127.0.0.1:8000/api/system/health
  from the server.
- In the dashboard: Connect agents shows Claude and Codex signed in; Meko shows "connected"; Ollama shows
  qwen2.5:0.5b installed.
- Run a New project with Research (Codex) → Draft (Claude), "One after another" on. Both finish, the writer's
  prompt contains the researcher's facts from the shared memory, the run gets analysed, and the session
  report opens.
- Architecture · BlastX: the demo stack map loads and failing demo-redis shows the API and worker breaking.
- Reboot the server once; everything comes back on its own (restart: unless-stopped).

Step 6: hand over
- Write what you changed and how to update, stop and back up into docs/DEPLOY.md (keep its plain style),
  including the Oracle iptables step and the idle-reclaim warning.
- Back up the database volume once: docker run --rm -v tower_tower-db:/d -v $PWD:/b alpine tar czf /b/db.tgz -C /d .
- Tell me the URL, what works, what doesn't, and anything I still have to do myself.

Plan B, only if I say there's no Oracle server: run the stack on my Windows laptop as today (UI on :3100,
API on :8010) and publish only the UI with a free Cloudflare Tunnel: install cloudflared and run
`cloudflared tunnel --url http://localhost:3100`. Set TOWER_ALLOWED_HOSTS to the tunnel host name and
AUTH_REQUIRED=true, add https://<tunnel-host>/api/auth/callback/google to the Google client, and restart the
UI. Quick tunnels get a new random name each run, so tell me that a named tunnel (free with a Cloudflare
account and a domain) keeps one fixed URL. Never publish port 8010.
```
