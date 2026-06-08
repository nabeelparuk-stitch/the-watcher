import type { FastifyInstance } from "fastify";
import {
  appendCheckoutReportToSheet,
  getGoogleSheetsConfig,
} from "../lib/googleSheets.js";
import { runCheckoutReport } from "../lib/runCheckoutReport.js";
import { createCheckoutReportSchema } from "../schemas/checkoutReport.js";

export async function checkoutReportsRoutes(app: FastifyInstance) {
  app.post("/checkout-reports", async (request, reply) => {
    const parsed = createCheckoutReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        details: parsed.error.flatten(),
      });
    }

    const timeoutSeconds = parsed.data.timeout_seconds ?? 120;

    try {
      const report = await runCheckoutReport(parsed.data.url, timeoutSeconds);

      const shouldAppend = parsed.data.append_to_sheet === true;
      const spreadsheetId =
        parsed.data.spreadsheet_id ??
        (shouldAppend ? getGoogleSheetsConfig().defaultSpreadsheetId : null);
      const sheetName =
        parsed.data.sheet_name?.trim() ||
        getGoogleSheetsConfig().defaultSheetName;

      if (shouldAppend && spreadsheetId) {
        report.sheets_append = await appendCheckoutReportToSheet(report, {
          spreadsheetId,
          sheetName,
        });
      }

      return reply.send(report);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      request.log.error({ err: message }, "checkout_report_failed");
      return reply.status(502).send({
        error: "checkout_report_failed",
        message,
      });
    }
  });
}
