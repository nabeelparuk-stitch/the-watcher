import { apiBaseUrl } from "@/lib/api";
import type { GoogleSheetsSettings } from "@/components/google-sheets-settings";
import type { CheckoutReport } from "@/components/checkout-report-form";

export type RunCheckoutOptions = {
  url: string;
  timeoutSeconds?: number;
  sheets?: GoogleSheetsSettings;
  appendToSheet?: boolean;
  signal?: AbortSignal;
};

export function sheetsPayload(
  sheets: GoogleSheetsSettings,
  forceAppend?: boolean
): Record<string, unknown> {
  const append = forceAppend ?? sheets.appendToSheet;
  if (!append) return {};
  const spreadsheetId = sheets.spreadsheetInput.trim();
  return {
    append_to_sheet: true,
    ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : {}),
    sheet_name: sheets.sheetName.trim() || "Results",
  };
}

export async function runCheckoutReport(
  options: RunCheckoutOptions
): Promise<CheckoutReport> {
  const {
    url,
    timeoutSeconds = 180,
    sheets,
    appendToSheet,
    signal,
  } = options;

  const body: Record<string, unknown> = {
    url,
    timeout_seconds: timeoutSeconds,
    ...(sheets ? sheetsPayload(sheets, appendToSheet) : {}),
  };

  const res = await fetch(`${apiBaseUrl()}/v1/checkout-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await res.json().catch(() => ({}))) as CheckoutReport & {
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  }

  return data;
}
