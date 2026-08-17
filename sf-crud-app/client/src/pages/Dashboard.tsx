export function Dashboard() {
  return (
    <main className="dashboard">
      <h1>Dashboard</h1>
      <p>You&apos;re logged in to Salesforce.</p>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          window.location.href = "/auth/logout";
        }}
      >
        Log out
      </button>
    </main>
  );
}
