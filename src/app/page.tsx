export default function Home() {
  return (
    <>
      <h1>Demand Planning</h1>
      <p className="lead">Runs twice a week, applies Raghav&apos;s rules to every SKU, and puts the flags in front of him.</p>
      <div className="notice">
        <strong>Demo build.</strong> There is no live SAP or Zoho connection. Data comes from CSV files (real exports can be dropped in on the
        Upload page) and the Zoho step is a mock. The system never places an order.
      </div>
      <div className="card">
        <strong>Phase 5 of 10: review, approvals and feedback capture.</strong>
        <p className="muted" style={{ marginBottom: 0 }}>
          Start at Review. Runs, the season calendar, the feedback summary, metrics and settings arrive in later phases.
        </p>
      </div>
    </>
  );
}
