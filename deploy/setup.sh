#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 server (x86, 4 GB RAM or more). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/bugHunterYash/BlastRadius-/feature/control-tower-live/deploy/setup.sh | bash -s -- your.domain
# or, from a clone:  sudo bash deploy/setup.sh your.domain
# With no domain it uses <server-ip>.sslip.io, which still gets a real HTTPS certificate.
set -euo pipefail

REPO=https://github.com/bugHunterYash/BlastRadius-.git
TOWER_BRANCH=${TOWER_BRANCH:-feature/control-tower-live}
ENGINE_BRANCH=${ENGINE_BRANCH:-feat/yash-YA-08}
ROOT=/opt/blastx
DOMAIN=${1:-}

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "Docker, firewall and swap"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
apt-get install -y -qq ufw git openssl >/dev/null
ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null
# 4 GB of swap: three agent CLIs, Ollama and the builds can briefly need more than 4 GB of RAM
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Code"
mkdir -p "$ROOT"
[ -d "$ROOT/tower" ] || git clone -q --branch "$TOWER_BRANCH" "$REPO" "$ROOT/tower"
[ -d "$ROOT/engine" ] || git clone -q --branch "$ENGINE_BRANCH" "$REPO" "$ROOT/engine"
git -C "$ROOT/tower" pull -q --ff-only
git -C "$ROOT/engine" pull -q --ff-only

say "BlastRadius engine and demo stack"
docker network inspect br-target >/dev/null 2>&1 || docker network create br-target >/dev/null
( cd "$ROOT/engine" && BLASTRADIUS_BIND=127.0.0.1 docker compose up -d --build )
( cd "$ROOT/engine/demo-app" && docker compose up -d --build )

say "Settings"
ENV="$ROOT/tower/deploy/.env"
if [ ! -f "$ENV" ]; then
  [ -n "$DOMAIN" ] || DOMAIN="$(curl -fsS https://api.ipify.org).sslip.io"
  read -rsp "Choose the UI password for user 'admin': " PW </dev/tty; echo
  # Caddy wants a bcrypt hash; compose reads $ as a variable, so each $ is written as $$
  HASH=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$PW" | sed 's/\$/$$/g')
  rnd() { openssl rand -hex 24; }
  sed -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" \
      -e "s|^UI_PASSWORD_HASH=.*|UI_PASSWORD_HASH=$HASH|" \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(rnd)|" \
      -e "s|^TOWER_API_TOKEN=.*|TOWER_API_TOKEN=$(rnd)|" \
      -e "s|^TOWER_INGEST_TOKEN=.*|TOWER_INGEST_TOKEN=$(rnd)|" \
      -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(rnd)|" \
      "$ROOT/tower/deploy/.env.example" > "$ENV"
  chmod 600 "$ENV"
  echo "Wrote $ENV. Add MEKO_API_KEY there if you use Meko, then re-run this script."
fi

say "Control Tower"
docker compose -f "$ROOT/tower/deploy/docker-compose.yml" --env-file "$ENV" up -d --build

DOMAIN=$(grep '^DOMAIN=' "$ENV" | cut -d= -f2)
say "Done"
cat <<EOF
Open https://$DOMAIN  (user: admin)

Sign the agents in once (their logins are kept in a Docker volume):
  Claude:  in the UI, Connect agents > Claude > Sign in  (open the link, paste the code back)
  Codex:   docker compose -f $ROOT/tower/deploy/docker-compose.yml exec -it tower-api codex login --device-auth
Check:     docker compose -f $ROOT/tower/deploy/docker-compose.yml ps
EOF
