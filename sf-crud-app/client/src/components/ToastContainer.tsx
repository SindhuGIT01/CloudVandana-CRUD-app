import type { Toast } from "../hooks/useToasts";

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.variant}`} role="status">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
