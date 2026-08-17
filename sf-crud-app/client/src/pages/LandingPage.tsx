import { Navigate } from "react-router-dom";
import { useAuthStatus } from "../hooks/useAuthStatus";

export function LandingPage() {
  const { status } = useAuthStatus();

  // Already logged in (e.g. came back to "/" with a live session) — skip
  // straight to the dashboard instead of showing the login button again.
  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  if (status === "loading") {
    return <p>Loading…</p>;
  }

  return (
    <main className="landing">
      <h1>sf-crud-app</h1>
      <p>Manage Salesforce records from a simple web app.</p>
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          // Full browser navigation, not a fetch — Salesforce's login page
          // has to load in the actual address bar, not behind an XHR call.
          window.location.href = "/auth/login";
        }}
      >
        Login with Salesforce
      </button>
    </main>
  );
}
