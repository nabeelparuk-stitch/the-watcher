# The Watcher — Agent Guide

Guidance for AI agents and developers working in this repository.

## What this project does

Monitors **Shopify** stores to verify **Stitch Express** is the **first payment method** on checkout.

**Stitch Express signature** (pass when this label is payment option #1):

`Pay with Apple Pay | Google Pay | Capitec Pay | Card | BNPL`

Alternate label on some stores:

`Pay with Apple | Google | Capitec | Card | BNPL`

**Modes:**

| Mode | Entry | Auth |
|------|-------|------|
| On-demand single | Home `/` → paste URL → Run report | None |
| On-demand bulk | **Bulk stores** → up to 100 URLs | None |
| Fleet monitoring | `/fleet`, checkout settings | Supabase sign-in |

Results can append to **Google Sheets** (one row per report). Fleet mode stores runs in Supabase and can open incidents + Slack alerts.

Full operator + setup docs: `docs/STITCH-EXPRESS-CHECKOUT-MONITOR.md`

---

## Architecture

```text
User → apps/web (Next.js)
     → POST /v1/checkout-reports (apps/api, Fastify)
     → spawn Python subprocess (apps/checkout-worker)
     → Playwright: homepage → product → cart → checkout → payment detect
     → JSON report (+ optional Google Sheets append)
```

**Monorepo layout:**

| Path | Stack | Role |
|------|-------|------|
| `apps/web` | Next.js 15 | Public checker UI, fleet dashboard |
| `apps/api` | Fastify + Zod | REST API, checkout report spawn, Sheets |
| `apps/checkout-worker` | Python + Playwright | Browser automation, Stitch detection |
| `apps/worker` | Node + Temporal | HTTP uptime probes (optional) |
| `supabase/migrations/` | SQL | Fleet schema, RLS, views |

---

## Key files (checkout path)

| File | Purpose |
|------|---------|
| `apps/web/components/checkout-report-form.tsx` | Single + bulk UI |
| `apps/web/components/google-sheets-settings.tsx` | Sheets config (localStorage) |
| `apps/web/lib/checkout-api.ts` | API client for reports |
| `apps/api/src/routes/checkoutReports.ts` | `POST /v1/checkout-reports` |
| `apps/api/src/lib/runCheckoutReport.ts` | Spawns Python worker |
| `apps/api/src/lib/googleSheets.ts` | Append rows via service account |
| `apps/checkout-worker/watcher_checkout/playwright_flow.py` | Full checkout flow |
| `apps/checkout-worker/watcher_checkout/shopify_nav.py` | Find products (JSON APIs) |
| `apps/checkout-worker/watcher_checkout/variant_select.py` | Variant dropdowns |
| `apps/checkout-worker/watcher_checkout/checkout_nav.py` | Cart → checkout (multi-click) |
| `apps/checkout-worker/watcher_checkout/checkout_advance.py` | Guest fields → payment step |
| `apps/checkout-worker/watcher_checkout/stitch_detect.py` | Payment method order + Stitch |
| `apps/checkout-worker/watcher_checkout/report.py` | CLI/API JSON report |

---

## Local development

**Minimum (public checker):**

```bash
npm run checkout:install          # venv + pip + Playwright Chromium
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev:api                   # :4000
npm run dev:web                   # :3000
```

**Playwright browsers:** installed to `apps/checkout-worker/.playwright-browsers`. API sets `PLAYWRIGHT_BROWSERS_PATH` when spawning the worker (see `runCheckoutReport.ts`). Do not rely on Cursor sandbox browser cache paths.

**Test checkout from CLI:**

```bash
cd apps/checkout-worker
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.playwright-browsers"
.venv/bin/python -m watcher_checkout.report "https://example-store.com" 180
```

**Test Google Sheets:**

```bash
cd apps/api
npx tsx scripts/test-sheets-append.ts
curl http://127.0.0.1:4000/v1/google-sheets/status
```

**Fleet (optional):** Supabase + Temporal + `npm run dev:checkout` — see `README.md`.

---

## API surface (public)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/health` | Liveness |
| `GET` | `/v1/google-sheets/status` | Sheets configured? service account email |
| `POST` | `/v1/checkout-reports` | Body: `url`, optional `timeout_seconds`, `append_to_sheet`, `spreadsheet_id`, `sheet_name` |

Authenticated routes under `/v1` (JWT): stores, incidents, alert rules, synthetic checkout configs.

---

## Coding conventions

### General

- **Minimize scope** — smallest correct diff; don't refactor unrelated code.
- **Match existing style** — naming, imports, error handling in each app.
- **No secrets in git** — `.env`, `.env.local`, `Thewatcherkey.json`, service account JSON are gitignored.
- **Don't commit** unless the user explicitly asks.
- **Don't update git config** unless the user explicitly asks.

### TypeScript (`apps/api`, `apps/web`)

- API uses `.js` extensions in imports (ESM).
- Validate request bodies with **Zod** in `apps/api/src/schemas/`.
- Public checkout route is **unauthenticated**; fleet routes use `registerV1Auth`.

### Python (`apps/checkout-worker`)

- Async Playwright throughout the checkout flow.
- Payment detection must scope to the **Payment** section and read **one label per radio** — avoid parent `div` `innerText` blobs that merge methods.
- Shopify payment radios often use `name="basic"` / `id` prefix `basic-`.
- Wait for async gateway loading before scanning (`_wait_for_payment_methods`, polling).
- Some stores label Stitch differently (e.g. "Apple pay and Google pay"); still list all methods even if Stitch signature pass fails.

### Web UI

- Store URL normalization: prepend `https://` if missing (`lib/checkout-url.ts`).
- Google Sheets prefs persist in **localStorage** (`google-sheets-settings.tsx`).
- Bulk runs are **sequential** (one Playwright subprocess at a time per API).

---

## Environment variables

### `apps/api/.env`

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 4000) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Required by API boot (fleet routes) |
| `CORS_ORIGIN` | Next.js origin(s) |
| `CHECKOUT_WORKER_DIR`, `CHECKOUT_PYTHON` | Worker paths |
| `PLAYWRIGHT_BROWSERS_PATH` | Chromium location |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Sheets service account JSON |
| `GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID` | Default sheet for UI prefill |
| `GOOGLE_SHEETS_DEFAULT_SHEET_NAME` | Tab name (default `Results`) |

### `apps/web/.env.local`

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | e.g. `http://127.0.0.1:4000` |
| Supabase vars | Fleet/auth only |

---

## Common tasks

### Add a payment method label to detection

Edit `looksLikePaymentLabel` and/or `isShopifyPaymentRadio` in `stitch_detect.py`. Re-test on a real store; don't break billing-address radio exclusion.

### Change bulk URL limit

`BULK_MAX` in `checkout-report-form.tsx` and default in `parseBulkUrls` (`lib/checkout-url.ts`). Update `README.md` and docs if changed.

### Add a column to Google Sheets export

Update `SHEET_HEADERS` and `reportToRow` in `apps/api/src/lib/googleSheets.ts`. Headers auto-write on first append to an empty sheet.

### Fix cart → checkout for a store pattern

`checkout_nav.py` — multi-step "Check out" (drawer → cart → checkout). Ignore "View cart" buttons.

---

## Troubleshooting (for agents)

| Issue | Where to look |
|-------|----------------|
| Only 1–2 payment methods | `stitch_detect.py` timing + label scoping |
| Playwright binary missing | `npm run checkout:playwright`; `PLAYWRIGHT_BROWSERS_PATH` |
| API 502 on report | API logs; Python stderr from worker |
| Sheets permission denied | Share spreadsheet with service account as Editor |
| Sheets API not enabled | Google Cloud Console → enable Sheets API |
| Stitch "not found" but wallets visible | Store may not use Stitch signature text; check `payment_methods_found` list |

---

## Testing checklist

Before claiming checkout detection works:

1. Run `watcher_checkout.report` on a known store (e.g. pokkelokkie.co.za).
2. Confirm `payment_method_count` matches manual checkout count.
3. Confirm `payment_methods_found` order matches visual order on page.
4. If Sheets enabled, confirm `sheets_append.ok === true`.

---

## Links

- **Repo:** https://github.com/nabeelparuk-stitch/the-watcher
- **Docs:** `docs/STITCH-EXPRESS-CHECKOUT-MONITOR.md`
- **README:** `README.md`
