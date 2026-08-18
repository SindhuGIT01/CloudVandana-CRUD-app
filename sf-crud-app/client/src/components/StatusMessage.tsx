import styles from "./StatusMessage.module.css";

interface StatusMessageProps {
  variant: "loading" | "error" | "empty";
  message: string;
}

// One shared visual language for "loading" / "error" / "empty" states,
// used everywhere something is fetched from the API — auth check, object
// fields, the records list, and form submission errors — instead of each
// spot inventing its own <p> styling.
export function StatusMessage({ variant, message }: StatusMessageProps) {
  return (
    <div
      className={`${styles.statusMessage} ${styles[variant]}`}
      role={variant === "error" ? "alert" : "status"}
    >
      {variant === "loading" && <span className={styles.spinner} aria-hidden="true" />}
      <span>{message}</span>
    </div>
  );
}
