"use client";

import { useRef, useState } from "react";
import {
  GoogleSheetsSettingsPanel,
  loadGoogleSheetsSettings,
  type GoogleSheetsSettings,
} from "@/components/google-sheets-settings";
import { ApiConnectionStatus } from "@/components/api-connection-status";
import { ReportDetailCard } from "@/components/report-detail-card";
import { runCheckoutReport } from "@/lib/checkout-api";
import { normalizeStoreUrl, parseBulkUrls } from "@/lib/checkout-url";

export type CheckoutReport = {
  input_url: string;
  status: string;
  verdict: string;
  stitch_express_is_top?: boolean | null;
  stitch_express_signature?: string;
  first_payment_method_text?: string | null;
  payment_methods?: string[];
  payment_methods_found?: Array<{
    position: number;
    label: string;
    is_stitch_express?: boolean;
  }>;
  stitch_index?: number;
  payment_method_count?: number;
  step?: string;
  error_message?: string | null;
  final_url?: string;
  product_url?: string | null;
  duration_ms?: number;
  checked_at: string;
  sheets_append?: {
    ok: boolean;
    spreadsheetId?: string;
    sheetName?: string;
    updatedRange?: string;
    error?: string;
  };
};

type BulkRow = {
  url: string;
  state: "pending" | "running" | "done" | "failed";
  report?: CheckoutReport;
  error?: string;
};

type Mode = "single" | "bulk";

const BULK_MAX = 100;

function canAppendToSheet(sheets: GoogleSheetsSettings): boolean {
  return sheets.appendToSheet;
}

export function CheckoutReportForm() {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CheckoutReport | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [sheets, setSheets] = useState<GoogleSheetsSettings>(() =>
    loadGoogleSheetsSettings()
  );
  const abortRef = useRef<AbortController | null>(null);

  function switchMode(next: Mode) {
    if (loading) return;
    setMode(next);
    setError(null);
    setReport(null);
    setBulkRows([]);
    setBulkProgress({ current: 0, total: 0 });
  }

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    const normalizedUrl = normalizeStoreUrl(url);
    if (!normalizedUrl) {
      setError("Enter a store URL.");
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 6 * 60 * 1000);

    try {
      const body = await runCheckoutReport({
        url: normalizedUrl,
        sheets,
        signal: controller.signal,
      });
      setReport(body);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("The check took too long and was cancelled. Try again.");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not reach the API. Is it running?"
        );
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function submitBulk(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);

    const urls = parseBulkUrls(bulkText, BULK_MAX);
    if (urls.length === 0) {
      setError("Enter at least one store URL (one per line).");
      return;
    }

    const append = canAppendToSheet(sheets);
    if (!append) {
      setError(
        "Enable “Append each report” in Google Sheets before running bulk checks."
      );
      return;
    }

    setLoading(true);
    const rows: BulkRow[] = urls.map((u) => ({ url: u, state: "pending" }));
    setBulkRows(rows);
    setBulkProgress({ current: 0, total: urls.length });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for (let i = 0; i < urls.length; i++) {
        if (controller.signal.aborted) break;

        setBulkProgress({ current: i + 1, total: urls.length });
        setBulkRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, state: "running" } : r))
        );

        try {
          const result = await runCheckoutReport({
            url: urls[i],
            sheets,
            appendToSheet: true,
            signal: controller.signal,
          });
          setBulkRows((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, state: "done", report: result } : r
            )
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Check failed";
          if (err instanceof Error && err.name === "AbortError") {
            setBulkRows((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, state: "failed", error: "Cancelled" } : r
              )
            );
            setError("Bulk run cancelled.");
            break;
          }
          setBulkRows((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, state: "failed", error: message } : r
            )
          );
        }
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  const bulkDone = bulkRows.filter((r) => r.state === "done").length;
  const bulkFailed = bulkRows.filter((r) => r.state === "failed").length;
  const bulkSheetsOk = bulkRows.filter(
    (r) => r.report?.sheets_append?.ok
  ).length;

  return (
    <div>
      <ApiConnectionStatus />
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className={mode === "single" ? "primary" : undefined}
          onClick={() => switchMode("single")}
          disabled={loading}
          style={mode !== "single" ? { opacity: 0.85 } : undefined}
        >
          Single store
        </button>
        <button
          type="button"
          className={mode === "bulk" ? "primary" : undefined}
          onClick={() => switchMode("bulk")}
          disabled={loading}
          style={mode !== "bulk" ? { opacity: 0.85 } : undefined}
        >
          Bulk stores
        </button>
      </div>

      {mode === "single" ? (
        <form onSubmit={submitSingle} className="card">
          <div className="form-field">
            <label htmlFor="check_url">Store homepage</label>
            <input
              id="check_url"
              name="check_url"
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="your-store.com"
              inputMode="url"
              autoComplete="url"
              disabled={loading}
            />
            <span
              className="muted"
              style={{ fontSize: "0.8rem", display: "block", marginTop: "0.35rem" }}
            >
              We open your store, find a product, add to cart, go to checkout, and
              check payment order. Usually 1–3 minutes.
            </span>
          </div>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Running check…" : "Run report"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitBulk} className="card">
          <div className="form-field">
            <label htmlFor="bulk_urls">Store URLs (one per line)</label>
            <textarea
              id="bulk_urls"
              name="bulk_urls"
              rows={8}
              required
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={
                "store-one.com\nhttps://store-two.com\nstore-three.com"
              }
              disabled={loading}
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: "inherit",
                resize: "vertical",
              }}
            />
            <span
              className="muted"
              style={{ fontSize: "0.8rem", display: "block", marginTop: "0.35rem" }}
            >
              Up to {BULK_MAX} stores. Each check runs one after another (~1–3 min
              each). Results are appended to Google Sheets when configured below.
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading
                ? `Checking ${bulkProgress.current} of ${bulkProgress.total}…`
                : "Run bulk report"}
            </button>
            {loading ? (
              <button type="button" onClick={cancelRun}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      )}

      <GoogleSheetsSettingsPanel
        settings={sheets}
        onChange={setSheets}
        disabled={loading}
      />

      {error ? (
        <p className="error" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}

      {loading && mode === "single" ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p style={{ margin: 0 }}>
            Browsing the store, finding a product, and reaching checkout…
          </p>
        </div>
      ) : null}

      {loading && mode === "bulk" && bulkRows.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p style={{ margin: "0 0 0.75rem" }}>
            Checking <strong>{bulkProgress.current}</strong> of{" "}
            <strong>{bulkProgress.total}</strong>…
          </p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {bulkRows.map((row) => (
              <li
                key={row.url}
                style={{
                  marginBottom: "0.5rem",
                  padding: "0.5rem 0.65rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  opacity: row.state === "pending" ? 0.55 : 1,
                }}
              >
                <span className="muted" style={{ fontSize: "0.75rem", marginRight: "0.5rem" }}>
                  {row.state === "pending"
                    ? "○"
                    : row.state === "running"
                      ? "…"
                      : row.state === "done"
                        ? "✓"
                        : "✗"}
                </span>
                <span style={{ wordBreak: "break-all" }}>{row.url}</span>
                {row.state === "done" && row.report ? (
                  <span
                    className="muted"
                    style={{ display: "block", fontSize: "0.8rem", marginTop: "0.25rem" }}
                  >
                    {row.report.verdict}
                    {row.report.sheets_append?.ok ? " · Sheet updated" : ""}
                  </span>
                ) : null}
                {row.state === "failed" && row.error ? (
                  <span
                    className="error"
                    style={{ display: "block", fontSize: "0.8rem", marginTop: "0.25rem" }}
                  >
                    {row.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === "bulk" && !loading && bulkRows.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
            Bulk complete
          </p>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
            {bulkDone} succeeded · {bulkFailed} failed
            {canAppendToSheet(sheets)
              ? ` · ${bulkSheetsOk} rows appended to sheet`
              : ""}
          </p>
          <table
            style={{
              width: "100%",
              marginTop: "0.75rem",
              fontSize: "0.85rem",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.4rem 0.5rem 0.4rem 0" }}>Store</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Verdict</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Stitch first</th>
                <th style={{ padding: "0.4rem 0 0.4rem 0.5rem" }}>Sheet</th>
              </tr>
            </thead>
            <tbody>
              {bulkRows.map((row) => (
                <tr
                  key={row.url}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "0.5rem 0.5rem 0.5rem 0", wordBreak: "break-all" }}>
                    {row.url.replace(/^https?:\/\//, "")}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {row.report?.verdict ?? row.error ?? "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {row.report?.stitch_express_is_top === true
                      ? "Yes"
                      : row.report?.stitch_express_is_top === false
                        ? "No"
                        : "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.5rem 0.5rem 0" }}>
                    {row.report?.sheets_append?.ok
                      ? "Yes"
                      : row.report?.sheets_append
                        ? "No"
                        : row.state === "failed"
                          ? "—"
                          : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {mode === "single" && report ? <ReportDetailCard report={report} /> : null}
    </div>
  );
}
