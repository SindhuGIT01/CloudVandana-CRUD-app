import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import session from "express-session";
import "./auth/session.js";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { authRouter } from "./routes/auth.js";
import { objectsRouter } from "./routes/objects.js";
import { recordsRouter } from "./routes/records.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  }),
);
app.use(express.json());

app.use(
  session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.isProduction,
      // Client (5173) and server (4000) are different origins but the same
      // registrable domain in local dev, so "lax" still sends the cookie.
      // Cross-domain deployments need "none" + secure (HTTPS) cookies.
      sameSite: env.isProduction ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/auth", authRouter);

// Mounted before requireAuth so health checks stay unauthenticated.
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api", requireAuth);
app.use("/api/objects", objectsRouter);
app.use("/api/records", recordsRouter);

// In production this one server also serves the built client (see README's
// Deployment section) — no separate static host needed. In dev, Vite's own
// dev server handles the client instead, so this is skipped entirely.
if (env.isProduction) {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  // SPA fallback: any GET that isn't /auth or /api and didn't match a static
  // file is a client-side route (e.g. /dashboard on a hard refresh) — let
  // React Router handle it once index.html loads.
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});
