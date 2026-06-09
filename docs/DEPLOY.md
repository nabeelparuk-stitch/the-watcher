# Deploying The Watcher

The app has two deployable parts:

| Component | Host | Why |
|-----------|------|-----|
| **Web** (`apps/web`) | [Vercel](https://vercel.com) | Next.js; static + server components |
| **API + Playwright** (`apps/api` + `apps/checkout-worker`) | [Railway](https://railway.app), [Fly.io](https://fly.io), or any Docker host | Needs Chromium, Python, long requests (1–3 min per check) |

Do **not** deploy the API to serverless with a 30s timeout (e.g. Vercel functions) — checkout checks will fail.

---

## Architecture (production)

```text
Vercel (Next.js)  →  Railway/Fly (Docker API)  →  Playwright subprocess
     ↓                        ↓
NEXT_PUBLIC_API_URL      Google Sheets (optional)
```

Fleet mode (Supabase auth, incidents) is optional. The **public checker** works with API + web only.

---

## 1. Deploy API (Docker)

### Option A — Railway (recommended)

1. Create a project at [railway.app](https://railway.app).
2. **New → GitHub Repo** → select `nabeelparuk-stitch/the-watcher`.
3. Railway detects `railway.toml` and builds the root `Dockerfile`.
4. Set **environment variables** (Settings → Variables):

| Variable | Required | Example |
|----------|----------|---------|
| `PORT` | Auto-set by Railway | `4000` |
| `CORS_ORIGIN` | Optional | `https://your-app.vercel.app` |
| `CORS_ALLOW_ALL` | Easiest | `true` (allows any origin for public checker) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | For Sheets | Paste JSON key on one line |
| `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` | Optional | Your sheet ID |
| `GOOGLE_SHEETS_DEFAULT_SHEET_NAME` | Optional | `Results` |
| `SUPABASE_URL` | Fleet only | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Fleet only | Supabase anon key |

5. **Settings → Networking → Generate domain** (e.g. `the-watcher-api.up.railway.app`).
6. Use at least **2 GB RAM** — Playwright + Chromium need memory.

**Note:** Use `GOOGLE_SERVICE_ACCOUNT_JSON` in production (not a file path). The API already supports this.

### Option B — Fly.io

```bash
fly launch --no-deploy
fly secrets set CORS_ORIGIN=https://your-app.vercel.app
fly secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
fly deploy
```

### Option C — Local Docker smoke test

```bash
docker build -t the-watcher-api .
docker run --rm -p 4000:4000 \
  -e CORS_ORIGIN=http://localhost:3000 \
  -e GOOGLE_SERVICE_ACCOUNT_JSON='...' \
  the-watcher-api
curl http://localhost:4000/health
```

---

## 2. Deploy Web (Vercel)

1. [vercel.com](https://vercel.com) → **Add New Project** → import `nabeelparuk-stitch/the-watcher`.
2. **Root Directory:** `apps/web`
3. Framework: **Next.js** (auto-detected; `vercel.json` sets monorepo install/build).
4. **Environment variables:**

| Variable | Required | Value |
|----------|----------|-------|
| `NEXT_PUBLIC_API_URL` | Yes | Railway/Fly API URL, e.g. `https://the-watcher-api.up.railway.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Fleet only | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Fleet only | Supabase anon key |

The public checker (`/`) works without Supabase env vars. Fleet/login pages need them.

5. Deploy. Open the Vercel URL and run a single-store check.

6. **Update API `CORS_ORIGIN`** to include your Vercel URL (comma-separated if multiple):

```bash
CORS_ORIGIN=https://the-watcher.vercel.app,https://the-watcher-xxx.vercel.app
```

Redeploy/restart the API after changing CORS.

---

## 3. Google Sheets in production

1. Enable **Google Sheets API** in Google Cloud.
2. Create a service account + JSON key.
3. Share the spreadsheet with `client_email` as **Editor**.
4. Set on the API host:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",...}
GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID=1zZwSynA-Jqrj4I0DNAsNNcH9x5326iDL59a4ribeLJo
GOOGLE_SHEETS_DEFAULT_SHEET_NAME=Results
```

Never commit the JSON key. Do not use `GOOGLE_SERVICE_ACCOUNT_PATH` in cloud unless you mount a secret volume.

---

## 4. Fleet mode (optional)

For `/fleet`, `/login`, incidents:

1. Create a [Supabase](https://supabase.com) project.
2. Run migrations from `supabase/migrations/`.
3. Set on API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
4. Set on Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Deploy Temporal + checkout worker separately (see `README.md`) — not required for the public checker.

---

## 5. Post-deploy checklist

- [ ] `GET https://<api>/health` returns `{"ok":true}`
- [ ] `GET https://<api>/v1/google-sheets/status` shows `configured: true` (if using Sheets)
- [ ] Vercel app loads; **Run report** completes (~1–3 min)
- [ ] Report shows payment methods; Sheets row appended (if enabled)
- [ ] Bulk check works (sequential; plan for long runs on 100 URLs)

---

## Limits & costs

- **Checkout duration:** ~1–3 minutes per store; bulk 100 can take hours (sequential).
- **Memory:** Recommend ≥ 2 GB for the API container.
- **Concurrent checks:** One Playwright subprocess per API request — avoid heavy parallel load on a single instance.
- **Playwright image size:** Docker image is ~1–2 GB due to Chromium.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS error in browser | Add Vercel URL to API `CORS_ORIGIN` |
| `NEXT_PUBLIC_API_URL is not set` | Set on Vercel, redeploy |
| 502 / timeout on report | Increase platform timeout; ensure ≥2 GB RAM |
| Playwright browser missing | Rebuild Docker image; check `PLAYWRIGHT_BROWSERS_PATH` |
| Sheets permission denied | Share sheet with service account email |
| Fleet routes 404 | Set `SUPABASE_URL` + `SUPABASE_ANON_KEY` on API |
