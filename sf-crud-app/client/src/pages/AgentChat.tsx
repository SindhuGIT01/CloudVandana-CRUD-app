import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { useAgentChat } from "../hooks/useAgentChat";

const EXAMPLES = [
  "Show me the 5 newest opportunities",
  "Find open cases with high priority",
  "Create a contact named Priya Rao",
];

export function AgentChat() {
  const { messages, sending, sendMessage } = useAgentChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the transcript grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
    setInput("");
  };

  return (
    <main className="dashboard agent-chat">
      <Header title="Salesforce Ops Agent" showLogout />
      <p className="agent-chat-back">
        <Link to="/dashboard">← Back to the CRUD dashboard</Link>
      </p>

      <div className="agent-chat-window">
        <div className="agent-chat-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="agent-chat-empty">
              <p>Type a plain-English command. For example:</p>
              <ul>
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void sendMessage(example)}
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`agent-bubble agent-bubble-${message.role}`}>
                {message.text}
              </div>
            ))
          )}
          {sending && (
            <div className="agent-bubble agent-bubble-agent agent-bubble-typing">Thinking…</div>
          )}
        </div>

        <form className="agent-chat-input" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="e.g. show me the 5 newest opportunities"
            disabled={sending}
            aria-label="Message to the agent"
          />
          <button
            type="submit"
            className="primary-button"
            disabled={sending || input.trim().length === 0}
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
