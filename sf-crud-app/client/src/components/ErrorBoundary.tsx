import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface ErrorBoundaryProps {
  children: ReactNode;
  // Shown in the fallback heading — lets a boundary scoped around one
  // section (e.g. the records table) say what broke, not just "the app."
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Catches render-time errors anywhere below it in the tree and shows a
// fallback instead of an unrecoverable blank page. Must be a class
// component — React has no hook equivalent for componentDidCatch.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in component tree:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.errorBoundary}>
          <h2>{this.props.label ? `Something went wrong in ${this.props.label}` : "Something went wrong"}</h2>
          <p>{this.state.error.message}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
