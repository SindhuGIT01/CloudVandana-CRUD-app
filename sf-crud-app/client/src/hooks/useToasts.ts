import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  message: string;
  variant: "success" | "error";
}

const TOAST_DURATION_MS = 4000;

export function useToasts(): { toasts: Toast[]; showToast: (message: string, variant: Toast["variant"]) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, variant: Toast["variant"]) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return { toasts, showToast };
}
