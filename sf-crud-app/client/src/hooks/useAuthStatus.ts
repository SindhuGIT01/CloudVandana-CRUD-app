import { useCallback, useEffect, useState } from "react";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthStatusResponse {
  authenticated: boolean;
}

// Pings the server to find out whether the current session has a logged-in
// Salesforce user. Deliberately three states, not a boolean — the caller
// needs to tell "still checking" apart from "checked, and you're logged
// out," otherwise a protected route would flash-redirect to login on every
// page load before the check even finishes.
export function useAuthStatus(): { status: AuthStatus; refresh: () => void } {
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refresh = useCallback(() => {
    setStatus("loading");
    fetch("/auth/status", { credentials: "include" })
      .then((res) => res.json() as Promise<AuthStatusResponse>)
      .then((data) => setStatus(data.authenticated ? "authenticated" : "unauthenticated"))
      .catch(() => setStatus("unauthenticated"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh };
}
