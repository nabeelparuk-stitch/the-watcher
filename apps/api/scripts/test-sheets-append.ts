/** Quick test: append one row to the configured Google Sheet. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  /* optional */
}

import { appendCheckoutReportToSheet } from "../src/lib/googleSheets.js";
import { parseSpreadsheetId } from "../src/lib/googleSheets.js";

const spreadsheetInput =
  process.argv[2] ||
  process.env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID ||
  "";
const sheetName = process.env.GOOGLE_SHEETS_DEFAULT_SHEET_NAME || "Results";
const spreadsheetId = parseSpreadsheetId(spreadsheetInput);

if (!spreadsheetId) {
  console.error("Usage: npx tsx scripts/test-sheets-append.ts <spreadsheet-url-or-id>");
  process.exit(1);
}

async function main() {
  const result = await appendCheckoutReportToSheet(
    {
      checked_at: new Date().toISOString(),
      input_url: "https://example.com",
      verdict: "Test row from The Watcher",
      status: "test",
      stitch_express_is_top: null,
      first_payment_method_text: null,
      payment_methods: ["Test"],
      payment_method_count: 1,
      step: "sheets_test",
      error_message: null,
      final_url: "",
      product_url: null,
      duration_ms: 0,
    },
    { spreadsheetId, sheetName }
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
