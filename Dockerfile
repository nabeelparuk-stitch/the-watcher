# API + Playwright checkout worker (single container)
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo install (API workspace only)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/

RUN npm ci --workspace=@watcher/api --include-workspace-root

COPY apps/api apps/api
COPY apps/checkout-worker apps/checkout-worker

RUN npm run build -w @watcher/api

RUN cd apps/checkout-worker \
  && python3 -m venv .venv \
  && .venv/bin/pip install --no-cache-dir -r requirements.txt \
  && PLAYWRIGHT_BROWSERS_PATH=/app/apps/checkout-worker/.playwright-browsers \
     .venv/bin/playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=4000
ENV CHECKOUT_WORKER_DIR=/app/apps/checkout-worker
ENV CHECKOUT_PYTHON=/app/apps/checkout-worker/.venv/bin/python
ENV PLAYWRIGHT_BROWSERS_PATH=/app/apps/checkout-worker/.playwright-browsers

WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
