import { Link } from "react-router-dom";
import { Header } from "../components/Header";

// Task 0 scaffold. Task 1 replaces this body with the real chat UI
// (message history + a text input that POSTs to /api/agent/chat).
export function AgentChat() {
  return (
    <main className="dashboard">
      <Header title="Salesforce Ops Agent" showLogout />
      <p>
        Chat interface coming in Task 1. For now this page only exists to
        prove the <code>/agent</code> route and the{" "}
        <code>POST /api/agent/chat</code> endpoint are wired up.
      </p>
      <p>
        <Link to="/dashboard">← Back to the CRUD dashboard</Link>
      </p>
    </main>
  );
}
