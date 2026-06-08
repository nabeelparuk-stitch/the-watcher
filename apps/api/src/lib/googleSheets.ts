import { readFileSync } from "node:fs";
import { google, type sheets_v4 } from "googleapis";
import type { CheckoutReport } from "./runCheckoutReport.js";

const SHEET_HEADERS = [
  "checked_at",
  "input_url",
  "verdict",
  "status",
  "stitch_express_is_top",
  "first_payment_method",
  "payment_methods",
  "stitch_index",
  "payment_method_count",
  "product_url",
  "final_url",
  "duration_ms",
  "error_message",
  "step",
] as const;

export type GoogleSheetsConfig = {
  configured: boolean;
  serviceAccountEmail: string | null;
  defaultSpreadsheetId: string | null;
  defaultSheetName: string;
};

export type SheetsAppendResult =
  | { ok: true; spreadsheetId: string; sheetName: string; updatedRange?: string }
  | { ok: false; error: string };

function loadServiceAccountCredentials(): Record<string, unknown> | null {
  const jsonInline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonInline) {
    try {
      return JSON.parse(jsonInline) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  const creds = loadServiceAccountCredentials();
  const email =
    creds && typeof creds.client_email === "string" ? creds.client_email : null;
  return {
    configured: Boolean(creds),
    serviceAccountEmail: email,
    defaultSpreadsheetId:
      process.env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID?.trim() || null,
    defaultSheetName: process.env.GOOGLE_SHEETS_DEFAULT_SHEET_NAME?.trim() || "Results",
  };
}

/** Parse spreadsheet ID from a full URL or raw ID. */
export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

function escapeSheetName(name: string): string {
  return name.replace(/'/g, "''");
}

function a1Range(sheetName: string, a1: string): string {
  return `'${escapeSheetName(sheetName)}'!${a1}`;
}

async function getSheetsClient(): Promise<sheets_v4.Sheets | null> {
  const creds = loadServiceAccountCredentials();
  if (!creds) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function reportToRow(report: CheckoutReport): string[] {
  const methods =
    report.payment_methods_found?.map((m) => m.label) ??
    report.payment_methods ??
    [];
  return [
    report.checked_at ?? new Date().toISOString(),
    report.input_url ?? "",
    report.verdict ?? "",
    report.status ?? "",
    report.stitch_express_is_top == null
      ? ""
      : report.stitch_express_is_top
        ? "yes"
        : "no",
    report.first_payment_method_text ?? "",
    methods.join(" | "),
    report.stitch_index != null ? String(report.stitch_index) : "",
    report.payment_method_count != null ? String(report.payment_method_count) : "",
    report.product_url ?? "",
    report.final_url ?? "",
    report.duration_ms != null ? String(report.duration_ms) : "",
    report.error_message ?? "",
    report.step ?? "",
  ];
}

async function ensureHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const range = a1Range(sheetName, "A1:A1");
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const first = existing.data.values?.[0]?.[0];
  if (first) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: a1Range(sheetName, "A1:N1"),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...SHEET_HEADERS]] },
  });
}

export async function appendCheckoutReportToSheet(
  report: CheckoutReport,
  options: { spreadsheetId: string; sheetName: string }
): Promise<SheetsAppendResult> {
  const sheets = await getSheetsClient();
  if (!sheets) {
    return {
      ok: false,
      error:
        "Google Sheets is not configured on the server (missing service account credentials).",
    };
  }

  const { spreadsheetId, sheetName } = options;

  try {
    await ensureHeaders(sheets, spreadsheetId, sheetName);
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1Range(sheetName, "A:N"),
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [reportToRow(report)] },
    });
    return {
      ok: true,
      spreadsheetId,
      sheetName,
      updatedRange: res.data.updates?.updatedRange ?? undefined,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (/permission|403|denied/i.test(message)) {
      return {
        ok: false,
        error: `Permission denied. Share the spreadsheet with the service account email as Editor.`,
      };
    }
    if (/not found|404|Unable to parse range/i.test(message)) {
      return {
        ok: false,
        error: `Spreadsheet or sheet tab not found. Check the spreadsheet ID and sheet name "${sheetName}".`,
      };
    }
    return { ok: false, error: message.slice(0, 500) };
  }
}
