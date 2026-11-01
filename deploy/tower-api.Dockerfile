# Control Tower API. Build context: the repo root (blastradius/).
FROM python:3.11-slim

# Node for the Codex CLI; git and ripgrep for the agents' own tools
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git ripgrep \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @openai/codex \
    && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app
COPY tower/backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# same layout as the repo's tower/ folder, so TOWER_ROOT resolves to /app
COPY tower/backend/app backend/app
COPY tower/backend/migrations backend/migrations
COPY tower/design design
COPY tower/demo-agents demo-agents
COPY tower/workspaces workspaces
COPY tests/fixtures/demo-compose.yaml blastx/demo-compose.yaml

# agents run as a normal user, never root; their sign-ins live in the mounted home folder
RUN useradd --create-home --uid 1000 tower && chown -R tower /app
USER tower
ENV PYTHONUNBUFFERED=1 BLASTX_DEMO_COMPOSE=/app/blastx/demo-compose.yaml

EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -fs http://127.0.0.1:8010/v1/health || exit 1
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8010"]
