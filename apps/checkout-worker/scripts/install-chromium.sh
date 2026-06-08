#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -x .venv/bin/playwright ]]; then
  echo "Missing .venv/bin/playwright. Run: npm run checkout:venv && npm run checkout:pip" >&2
  exit 1
fi
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$ROOT/.playwright-browsers}"
exec .venv/bin/playwright install chromium
