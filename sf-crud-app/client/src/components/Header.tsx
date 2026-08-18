import styles from "./Header.module.css";

interface HeaderProps {
  title: string;
  showLogout?: boolean;
}

export function Header({ title, showLogout = false }: HeaderProps) {
  return (
    <header className={styles.header}>
      <h1>{title}</h1>
      {showLogout && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            window.location.href = "/auth/logout";
          }}
        >
          Logout
        </button>
      )}
    </header>
  );
}
