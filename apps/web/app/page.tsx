import { CheckoutReportForm } from "@/components/checkout-report-form";

export default function HomePage() {
  return (
    <div>
      <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem" }}>
        Stitch Express checkout check
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Paste your Shopify store homepage (or use <strong>Bulk stores</strong> for
        many URLs). We browse collections to find a product, simulate checkout,
        and report whether Stitch Express is the first payment method (
        <span style={{ fontSize: "0.85rem" }}>
          Pay with Apple | Google | Capitec | Card | BNPL
        </span>
        ). Results can append to Google Sheets row by row.
      </p>
      <CheckoutReportForm />
    </div>
  );
}
