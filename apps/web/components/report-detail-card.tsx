import type { CheckoutReport } from "@/components/checkout-report-form";

export function ReportDetailCard({ report }: { report: CheckoutReport }) {
  const passed = report.stitch_express_is_top === true;

  return (
    <div
      className="card report-card"
      style={{
        marginTop: "1rem",
        borderColor: passed ? "var(--success)" : "var(--danger)",
      }}
    >
      <p
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.15rem",
          fontWeight: 600,
          color: passed ? "var(--success)" : "var(--danger)",
        }}
      >
        {report.verdict}
      </p>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Checked {new Date(report.checked_at).toLocaleString()}
        {report.duration_ms != null
          ? ` · ${(report.duration_ms / 1000).toFixed(1)}s`
          : ""}
      </p>

      <dl className="report-dl">
        <div>
          <dt>Store URL</dt>
          <dd style={{ wordBreak: "break-all" }}>{report.input_url}</dd>
        </div>
        {report.product_url ? (
          <div>
            <dt>Product used</dt>
            <dd style={{ wordBreak: "break-all" }}>{report.product_url}</dd>
          </div>
        ) : null}
        {report.final_url ? (
          <div>
            <dt>Checkout URL</dt>
            <dd style={{ wordBreak: "break-all" }}>{report.final_url}</dd>
          </div>
        ) : null}
        <div>
          <dt>Payment methods found</dt>
          <dd>
            {report.payment_methods_found &&
            report.payment_methods_found.length > 0 ? (
              <ol
                className="payment-methods-list"
                style={{ margin: "0.25rem 0 0", paddingLeft: 0, listStyle: "none" }}
              >
                {report.payment_methods_found.map((m) => (
                  <li
                    key={m.position}
                    style={{
                      marginBottom: "0.5rem",
                      padding: "0.5rem 0.65rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: m.is_stitch_express
                        ? "rgba(61, 214, 140, 0.08)"
                        : "transparent",
                    }}
                  >
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      #{m.position}{" "}
                    </span>
                    {m.label}
                    {m.is_stitch_express ? (
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          fontSize: "0.72rem",
                          color: "var(--success)",
                          fontWeight: 600,
                        }}
                      >
                        Stitch Express
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : report.payment_methods && report.payment_methods.length > 0 ? (
              <ol style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                {report.payment_methods.map((m, i) => (
                  <li key={i} style={{ marginBottom: "0.35rem" }}>
                    {i + 1}. {m}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="muted">None detected on checkout</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Stitch Express first</dt>
          <dd>
            {report.stitch_express_is_top === true
              ? "Yes"
              : report.stitch_express_is_top === false
                ? "No"
                : "Unknown"}
          </dd>
        </div>
        {report.stitch_express_signature ? (
          <div>
            <dt>Stitch signature</dt>
            <dd>
              <code style={{ fontSize: "0.8rem" }}>{report.stitch_express_signature}</code>
            </dd>
          </div>
        ) : null}
        {report.step ? (
          <div>
            <dt>Step</dt>
            <dd>{report.step}</dd>
          </div>
        ) : null}
        {report.error_message ? (
          <div>
            <dt>Details</dt>
            <dd className="error">{report.error_message}</dd>
          </div>
        ) : null}
        {report.sheets_append ? (
          <div>
            <dt>Google Sheets</dt>
            <dd>
              {report.sheets_append.ok ? (
                <span style={{ color: "var(--success)" }}>
                  Row appended
                  {report.sheets_append.sheetName
                    ? ` to “${report.sheets_append.sheetName}”`
                    : ""}
                </span>
              ) : (
                <span className="error">
                  {report.sheets_append.error ?? "Could not append row"}
                </span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
