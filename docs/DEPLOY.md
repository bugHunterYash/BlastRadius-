# Deploying Agent Control Tower + BlastX

One Ubuntu server runs the whole product: the tower (UI and API), its Postgres, Ollama for summaries,
the BlastRadius engine with its demo stack, and Caddy for HTTPS and the login. Everything is in Docker.

## 1. Which provider

**Neither Vultr nor DigitalOcean is free for long.** Both give new accounts trial credit, then bill monthly.

| | DigitalOcean | Vultr |
|---|---|---|
| Plan needed | Basic Regular, 2 vCPU / 4 GB / 80 GB | Cloud Compute Regular, 2 vCPU / 4 GB |
| Price after credit | $24/month (official) | about $20–24/month (sources disagree; check vultr.com/pricing) |
| New-account credit | Student Pack credit ended 31 Jul 2026; other promos unverified | "Free credits for up to 30 days" (official docs; amount varies) |
| India regions | Bangalore | Mumbai, Delhi, Bangalore |

**Recommendation: Vultr**, 2 vCPU / 4 GB, Mumbai or Bangalore. It is at least as cheap, has more Indian
regions (lower latency for a demo in India), and its 30-day new-account credit covers a hackathon.
Pick DigitalOcean only if you get a verified credit that lasts longer. Either way, **destroy the server
when you're done, or billing continues after the credit runs out.**

Not suitable: free ARM servers (e.g. Oracle Always Free). The BlastRadius engine image is x86-only
(it installs the amd64 build of k6). Smaller than 4 GB RAM won't fit three agent CLIs, Ollama and the engine.

## 2. Before you deploy

1. **Push the engine branch.** The engine fixes are on `feat/yash-YA-08` in the `cbs final` repo,
   which isn't on GitHub yet. `setup.sh` clones it. (Or set `ENGINE_BRANCH=main` if it's merged.)
2. **A domain (optional).** Point an A record at the server IP. Without one, `setup.sh` uses
   `<server-ip>.sslip.io`, which still gets a real HTTPS certificate.

## 3. Deploy (about 15 minutes)

```bash
ssh root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/bugHunterYash/BlastRadius-/feature/control-tower-live/deploy/setup.sh -o setup.sh
bash setup.sh                 # or: bash setup.sh your.domain
```

The script installs Docker, opens only ports 22/80/443, adds 4 GB swap, clones the code, starts the
engine and demo stack, writes `deploy/.env` with random secrets (it asks for your UI password and keeps
only its hash), pulls the Ollama model and starts the tower.

Then sign the agents in once (the logins are kept in a Docker volume):
- **Claude:** in the UI, *Connect agents → Claude → Sign in*, open the link, paste the code back.
- **Codex:** `docker compose -f /opt/blastx/tower/deploy/docker-compose.yml exec -it tower-api codex login --device-auth`
- **Meko:** put `MEKO_API_KEY` in `/opt/blastx/tower/deploy/.env` and run `bash setup.sh` again.

## 4. What runs where

| Service | Reachable from the internet? |
|---|---|
| Caddy (HTTPS + login) | Yes, 80/443 only |
| Tower UI (Next.js) | Only through Caddy, after login |
| Tower API, Postgres, Ollama | No: private Docker network |
| BlastRadius engine | No: bound to 127.0.0.1 and the private network |
| Demo stack (api, redis, postgres, worker, frontend) | No: 127.0.0.1 only |

## 5. What works in the cloud, and what doesn't (yet)

**Works:** the chat with Claude and Codex agents, @tags, new projects, the session report and PDF,
BlastX (architecture map and "what breaks if Redis goes down"), Meko memory, Ollama summaries,
detectors and fixes.

**Not in the cloud yet:**
- **Live sync of your own chats.** It reads the Claude, Codex and Antigravity apps on the machine it
  runs on; a server doesn't have your apps. Next step: a small sync agent on your laptop that pushes
  your chats to the cloud tower (the ingest token already exists for this).
- **Antigravity agent.** The image doesn't include Antigravity's CLI for Linux, so it's off
  (`ANTIGRAVITY_RUNTIME_ENABLED=false`).
- **Project folders** must be on the server (clone the repo there) to assign agents work in them.

## 6. Ollama on the server

CPU only, no GPU needed. `qwen2.5:0.5b` uses about 1 GB of RAM and writes a run summary in seconds to a
minute. On an 8 GB server you can set `OLLAMA_MODEL=qwen2.5:1.5b` for better summaries. Every number in
reports is counted from the database; the model only writes the summary text.

## 7. Day-to-day

```bash
cd /opt/blastx/tower
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps          # status
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f tower-api
git pull && bash deploy/setup.sh                                                # update
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down         # stop (data kept)
```
Back up the `tower_tower-db` volume (`docker run --rm -v tower_tower-db:/d -v $PWD:/b alpine tar czf /b/db.tgz -C /d .`).
