"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "@/lib/api";

const LS_SPREADSHEET = "watcher_sheets_spreadsheet";
const LS_SHEET_NAME = "watcher_sheets_sheet_name";
const LS_APPEND = "watcher_sheets_append";

export type GoogleSheetsSettings = {
  appendToSheet: boolean;
  spreadsheetInput: string;
  sheetName: string;
};

type SheetsStatus = {
  configured: boolean;
  serviceAccountEmail: string | null;
  defaultSpreadsheetId: string | null;
  defaultSheetName: string;
};

export function loadGoogleSheetsSettings(): GoogleSheetsSettings {
  if (typeof window === "undefined") {
    return { appendToSheet: false, spreadsheetInput: "", sheetName: "Results" };
  }
  return {
    appendToSheet: localStorage.getItem(LS_APPEND) === "1",
    spreadsheetInput: localStorage.getItem(LS_SPREADSHEET) ?? "",
    sheetName: localStorage.getItem(LS_SHEET_NAME) || "Results",
  };
}

export function saveGoogleSheetsSettings(s: GoogleSheetsSettings) {
  localStorage.setItem(LS_APPEND, s.appendToSheet ? "1" : "0");
  localStorage.setItem(LS_SPREADSHEET, s.spreadsheetInput.trim());
  localStorage.setItem(LS_SHEET_NAME, s.sheetName.trim() || "Results");
}

type Props = {
  settings: GoogleSheetsSettings;
  onChange: (settings: GoogleSheetsSettings) => void;
  disabled?: boolean;
};

export function GoogleSheetsSettingsPanel({
  settings,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(settings.appendToSheet);
  const [status, setStatus] = useState<SheetsStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/v1/google-sheets/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as SheetsStatus;
        if (!cancelled) {
          setStatus(body);
          if (body.defaultSpreadsheetId && !settings.spreadsheetInput.trim()) {
            const prefilled = {
              ...settings,
              spreadsheetInput: `https://docs.google.com/spreadsheets/d/${body.defaultSpreadsheetId}/edit`,
              sheetName: body.defaultSheetName || settings.sheetName,
            };
            onChange(prefilled);
            saveGoogleSheetsSettings(prefilled);
          }
        }
      } catch {
        if (!cancelled) setStatusError("Could not load Google Sheets status from API.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  function patch(partial: Partial<GoogleSheetsSettings>) {
    const next = { ...settings, ...partial };
    onChange(next);
    saveGoogleSheetsSettings(next);
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "1rem",
        padding: "1rem",
        background: "var(--surface, rgba(255,255,255,0.03))",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: 0,
          fontSize: "1rem",
          fontWeight: 600,
        }}
      >
        <span>Google Sheets</span>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: "1rem" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1rem",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={settings.appendToSheet}
              disabled={disabled}
              onChange={(e) => patch({ appendToSheet: e.target.checked })}
            />
            Append each report as a new row in Google Sheets
          </label>

          <div className="form-field">
            <label htmlFor="spreadsheet_id">Spreadsheet URL or ID</label>
            <input
              id="spreadsheet_id"
              type="text"
              value={settings.spreadsheetInput}
              onChange={(e) => patch({ spreadsheetInput: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/…/edit"
              disabled={disabled}
              autoComplete="off"
            />
          </div>

          <div className="form-field">
            <label htmlFor="sheet_name">Sheet tab name</label>
            <input
              id="sheet_name"
              type="text"
              value={settings.sheetName}
              onChange={(e) => patch({ sheetName: e.target.value })}
              placeholder="Results"
              disabled={disabled}
            />
            <span
              className="muted"
              style={{ fontSize: "0.8rem", display: "block", marginTop: "0.35rem" }}
            >
              Tab must exist in your spreadsheet (e.g. a sheet named &quot;Results&quot;).
            </span>
          </div>

          {statusError ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {statusError}
            </p>
          ) : null}

          {status?.configured && status.serviceAccountEmail ? (
            <div
              style={{
                fontSize: "0.85rem",
                padding: "0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                marginTop: "0.5rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
                Share your spreadsheet with:
              </p>
              <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>
                {status.serviceAccountEmail}
              </code>
              <p className="muted" style={{ margin: "0.5rem 0 0" }}>
                Grant <strong>Editor</strong> access so the app can append rows.
              </p>
            </div>
          ) : status && !status.configured ? (
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Google Sheets is not configured on the API yet. Add a service account
              (see README).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
