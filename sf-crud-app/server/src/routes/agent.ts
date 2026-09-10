import { Router } from "express";
import { runAgent } from "../agent/runAgent.js";

export const agentRouter = Router();

// POST /api/agent/chat
// Mounted under /api, so requireAuth has already run and req.session.sf is
// present and refreshed by the time this handler executes.
//
// Body: { message: string }
// Later tasks add { history: [...] } for multi-turn context and a
// confirmation round-trip for destructive actions.
agentRouter.post("/chat", async (req, res) => {
  const sf = req.session.sf;
  if (!sf) {
    // requireAuth guarantees this; the check only narrows the type.
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "Body must include a non-empty 'message' string." });
    return;
  }

  try {
    const result = await runAgent(message, sf);
    res.json(result);
  } catch (error) {
    console.error("Agent request failed:", error);
    res.status(500).json({ error: "The agent hit an unexpected error." });
  }
});
