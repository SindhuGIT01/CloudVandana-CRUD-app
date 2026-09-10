import { useCallback, useRef, useState } from "react";

export type AgentMessageRole = "user" | "agent" | "error";

export interface AgentMessage {
  id: number;
  role: AgentMessageRole;
  text: string;
}

interface ChatResponse {
  reply?: string;
  error?: string;
  awaitingConfirmation?: boolean;
  sessionExpired?: boolean;
}

// Owns the chat transcript and the send-to-backend logic for the agent
// page. The backend (POST /api/agent/chat) is still a stub in Task 1, so
// replies are placeholder text — this task is the UI plumbing:
// input -> POST -> append reply -> transcript persists in state.
export function useAgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sending, setSending] = useState(false);
  // True while the agent is holding a destructive action pending a
  // yes/no from the user — drives the Yes/No shortcut buttons.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  // Guards against a second submit while a request is in flight; kept as a
  // ref so sendMessage can stay a stable useCallback.
  const sendingRef = useRef(false);
  const nextId = useRef(0);

  const append = useCallback((role: AgentMessageRole, text: string) => {
    const id = (nextId.current += 1);
    setMessages((prev) => [...prev, { id, role, text }]);
  }, []);

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sendingRef.current) return;

      append("user", text);
      sendingRef.current = true;
      setSending(true);
      setAwaitingConfirmation(false);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = (await res.json().catch(() => null)) as ChatResponse | null;

        if (!res.ok) {
          append("error", data?.error ?? `The agent request failed (${res.status}).`);
        } else if (data?.sessionExpired) {
          append("error", data.reply ?? "Your Salesforce session expired. Please log in again.");
          setAwaitingConfirmation(false);
        } else {
          append("agent", data?.reply ?? "(the agent returned an empty reply)");
          setAwaitingConfirmation(data?.awaitingConfirmation === true);
        }
      } catch {
        append("error", "Couldn't reach the agent. Check your connection and try again.");
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [append],
  );

  return { messages, sending, awaitingConfirmation, sendMessage };
}
