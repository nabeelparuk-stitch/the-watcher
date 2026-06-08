import { z } from "zod";
import { parseSpreadsheetId } from "../lib/googleSheets.js";

function withHttpsIfMissing(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function normalizeSpreadsheetId(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const id = parseSpreadsheetId(String(value));
  return id ?? undefined;
}

export const createCheckoutReportSchema = z
  .object({
    url: z.preprocess(withHttpsIfMissing, z.string().url().max(2048)),
    timeout_seconds: z.number().int().min(30).max(600).optional(),
    append_to_sheet: z.boolean().optional(),
    spreadsheet_id: z.preprocess(normalizeSpreadsheetId, z.string().optional()),
    sheet_name: z.string().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.append_to_sheet && !data.spreadsheet_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "spreadsheet_id is required when append_to_sheet is true",
        path: ["spreadsheet_id"],
      });
    }
  });
