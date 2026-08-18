import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { StatusMessage } from "./StatusMessage";

// Wraps a route element; renders it only once we know the user is actually
// logged in. Bounces back to the landing page otherwise.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuthStatus();

  if (status === "loading") {
    return <StatusMessage variant="loading" message="Checking session…" />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
