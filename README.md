# The Watcher

Monitors **Shopify** stores to confirm **Stitch Express** is the **first payment method** on checkout. Stitch Express is identified by the subtitle:

`Pay with Apple Pay | Google Pay | Capitec Pay | Card | BNPL`

When Stitch Express is not listed first, the app records a failed checkout run and opens a **Stitch Express** incident (Slack optional via alert rules).

Stack: **Supabase** (Postgres + Auth + RLS), **Next.js** dashboard, **Fastify API** (mutations), **Temporal** + **Node worker** (HTTP uptime probes), **Python worker** (Playwright checkout).

## Prerequisites

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli) and **Docker Desktop** (for `supabase start`)
- [Temporal CLI](https://docs.temporal.io/cli#install) for local scheduling, or **Temporal Cloud**
- Python 3.11+ for the checkout worker

## 1. Database and Auth

```bash
cd "/Users/nabeelparuk/Documents/The Watcher"
supabase start
supabase db reset
```

Copy keys from `supabase status` into env files (see `.env.example` files under `apps/web` and `apps/worker`).

For local email/password sign-in: in Supabase Studio (**Authentication → Providers**), enable **Email**. You can disable “Confirm email” for faster local iteration.

## 2. Temporal

Local dev server (listens on `127.0.0.1:7233`):

```bash
temporal server start-dev
```

HTTP probe schedule (every **30 minutes**):

```bash
cd "/Users/nabeelparuk/Documents/The Watcher"
cp apps/worker/.env.example apps/worker/.env
npm run schedule:create
```

## 3. Node worker (optional uptime)

```bash
npm run dev:worker
```

Performs HTTP `GET` to each store `base_url` and records `probe_runs`.

## 4. API (mutations)

```bash
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

Routes under `/v1` with bearer JWT: stores, notification channels, alert rules, incidents, synthetic checkout configs.

## 5. Web dashboard

```bash
cp apps/web/.env.example apps/web/.env.local
npm run dev:web
```

### Check a URL (on-demand report, no sign-in)

1. Open the app home page (`/`).
2. Paste your Shopify **store homepage** URL (e.g. `https://your-store.com`).
3. Click **Run report** — we browse collections/catalog to find a product, simulate checkout, and check Stitch Express (1–3 minutes).
4. You get a verdict, payment method order, and whether Stitch Express is first.

**Bulk:** switch to **Bulk stores**, paste up to 100 URLs (one per line), enable Google Sheets append, and run — each store is checked in sequence and one row is added per result.

Requires **API** (`npm run dev:api`) with Playwright set up under `apps/checkout-worker`. No Supabase account needed for this flow.

#### Google Sheets (optional)

Append each report as a row in your own spreadsheet:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **Google Sheets API**.
2. Create a **service account**, download the JSON key, and set in `apps/api/.env`:
   - `GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/key.json` (recommended), or
   - `GOOGLE_SERVICE_ACCOUNT_JSON=` with the JSON on one line.
3. Create a Google Sheet with a tab named **Results** (or another name you configure in the UI).
4. **Share** the spreadsheet with the service account email (`client_email` in the JSON) as **Editor**.
5. On the home page, open **Google Sheets**, paste your spreadsheet URL, enable **Append each report**, and run a check.

Column headers are written automatically on first append: `checked_at`, `input_url`, `verdict`, `status`, `stitch_express_is_top`, payment methods, URLs, duration, errors, etc.

### Fleet monitoring (scheduled, optional — sign-in)

For multi-store dashboards, incidents, and Slack alerts: sign in at `/login`, then use **Fleet** (`/fleet`), stores, and checkout settings. Requires Supabase.

## 6. Checkout worker (Playwright + Temporal)

```bash
cd "/Users/nabeelparuk/Documents/The Watcher"
npm run checkout:venv
npm run checkout:pip
npm run checkout:playwright
cp apps/checkout-worker/.env.example apps/checkout-worker/.env
npm run checkout:schedule
npm run dev:checkout
```

- Task queue: **`watcher-checkout`**, workflow **`CheckoutSweepWorkflow`**
- Schedule **`checkout-sweep`** (default every **6 hours**; override with `CHECKOUT_SCHEDULE_HOURS` in `apps/checkout-worker/.env`)

### What each run does

1. Open the configured Shopify product URL.
2. Add to cart and navigate to checkout.
3. Detect payment methods in visual order on the checkout page.
4. **Pass** if Stitch Express (matching the signature above) is first; **fail** and flag otherwise.

Results are stored in `synthetic_checkout_runs` (`stitch_express_is_top`, `first_payment_method_text`). Failures can open `stitch_checkout` incidents and notify Slack when alert rules are configured.

## Deploy (production)

**Web** → [Vercel](https://vercel.com) (`apps/web`)  
**API + Playwright** → [Railway](https://railway.app) or Fly.io (root `Dockerfile`)

Step-by-step: **[docs/DEPLOY.md](docs/DEPLOY.md)**

Quick summary:

1. Deploy API from Docker (`railway.toml` included) — set `CORS_ORIGIN` and `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. Deploy web to Vercel with root `apps/web` — set `NEXT_PUBLIC_API_URL` to your API URL.
3. Supabase is optional (public checker only); fleet mode needs Supabase env on both services.

## Project layout

| Path | Role |
|------|------|
| `supabase/migrations/` | Schema, RLS, `fleet_status` view |
| `apps/web` | Next.js dashboard |
| `apps/api` | Fastify REST API |
| `apps/worker` | HTTP uptime probes |
| `apps/checkout-worker` | Stitch Express checkout monitoring |
