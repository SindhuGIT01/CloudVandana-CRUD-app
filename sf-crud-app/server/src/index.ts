import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import session from "express-session";
import "./auth/session.js";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { authRouter } from "./routes/auth.js";
import { objectsRouter } from "./routes/objects.js";

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

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});
