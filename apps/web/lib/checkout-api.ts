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

  const apiUrl = apiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/checkout-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const hint =
      /localhost|127\.0\.0\.1/i.test(apiUrl)
        ? " NEXT_PUBLIC_API_URL points to localhost — set your public Railway/Fly API URL on Vercel and redeploy."
        : " Check the API is deployed, CORS_ALLOW_ALL=true on the API, and NEXT_PUBLIC_API_URL on Vercel.";
    throw new Error(
      `Could not reach the API at ${apiUrl}.${hint}`
    );
  }

  const data = (await res.json().catch(() => ({}))) as CheckoutReport & {
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  }

  return data;
}
