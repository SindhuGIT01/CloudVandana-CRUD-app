# sf-crud-app

Full-stack CRUD app scaffold.

- `server/` — Node.js + Express + TypeScript API
- `client/` — React + Vite + TypeScript frontend

## Getting started

Install dependencies (a root `postinstall` hook also installs `server/` and
`client/`'s own dependencies — this is not an npm workspaces setup, each
folder has its own separate `package.json`/`node_modules`, so this hook is
what makes a single `npm install` enough, both locally and on a host):

```bash
npm install
```

Copy the environment files and fill in values as needed:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Run both apps in dev mode concurrently:

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:4000 (health check at `/api/health`)

The Vite dev server proxies `/api` requests to the Express server, so the client can call `/api/...` directly without CORS issues in development.

## Other scripts

Run from the root, targeting either workspace:

```bash
npm run dev:server     # server only
npm run dev:client     # client only
npm run build:server   # compile server TypeScript
npm run build:client   # build client for production
npm run build           # build client, then server — the production build
npm start                # run the production build (npm run build first)
npm run lint:server    # lint server
npm run lint:client    # lint client
```

## Deployment

This app deploys as **one service**: the Express server serves its own API
*and* the built React client as static files, so there's only one URL and
one origin to manage (no separate frontend host, no cross-origin CORS/cookie
setup to get right). That wiring lives in `server/src/index.ts` — when
`NODE_ENV=production`, the server serves `client/dist` and falls back to
`client/dist/index.html` for any unmatched route so client-side routes like
`/dashboard` still work on a hard refresh or direct link.

This assumes both `server/` and `client/` are checked out side by side on
the host (as they already are in this repo) — the server locates
`client/dist` relative to its own compiled output.

### Deploying to Render (free tier)

1. Push this repo to GitHub (already done).
2. In Render, create a new **Web Service** from the repo.
   - If Render asks for a root directory and only sees the outer repo
     wrapper, point it at `sf-crud-app` — that's the actual app root.
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
3. Add the environment variables listed below in Render's dashboard (never
   commit these — see `server/.env.example` for the full list with
   explanations).
4. Deploy. Render gives you a URL like `https://your-app.onrender.com`.
5. **Update two environment variables to match that URL** once you know it:
   - `CLIENT_URL=https://your-app.onrender.com`
   - `REDIRECT_URI=https://your-app.onrender.com/auth/callback`
   Redeploy (or Render will pick up the env var change and restart on its own).
6. **Update the Salesforce External Client App's callback URL** (manual —
   this happens in Salesforce Setup, not in this repo): Setup → App Manager
   → find the External Client App → Edit → OAuth Settings → add
   `https://your-app.onrender.com/auth/callback` to the Callback URLs.
   **Add** it alongside the existing `http://localhost:4000/auth/callback`
   rather than replacing it, so local development keeps working too.

### Environment variables (production)

Set these in your host's dashboard — never commit real values. Full context
for each is in `server/.env.example`, summarized here:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` — enables the static-file serving described above |
| `PORT` | Usually set automatically by the host (Render sets this for you) |
| `CLIENT_URL` | Your deployed URL, e.g. `https://your-app.onrender.com` — used for the post-login redirect, logout redirect, and CORS origin |
| `CLIENT_ID` | From the Salesforce External Client App |
| `CLIENT_SECRET` | From the Salesforce External Client App — keep secret |
| `REDIRECT_URI` | `https://your-app.onrender.com/auth/callback` — must exactly match a Callback URL on the External Client App |
| `SF_LOGIN_URL` | `https://login.salesforce.com` (or `https://test.salesforce.com` for a sandbox) |
| `SESSION_SECRET` | A long random string, e.g. `openssl rand -hex 32` — keep secret, different from the dev value |

`client/.env.example`'s `VITE_API_URL` is not read by any code — the client
only ever makes relative `fetch('/api/...')` calls, so once it's served by
the same Express server (or proxied by Vite in dev) it always resolves
correctly with no configuration. It's there in case you later split the
client onto its own host (Vercel/Netlify) instead of this single-service
setup — see "Alternative: separate hosts" below.

### Known limitation: session storage

Sessions are held in-memory (`express-session`'s default `MemoryStore`) —
fine for local dev and a single small deployment, but it means logins don't
survive a server restart/redeploy, and it won't scale past one instance.
Render logs a warning about this on startup; that's expected. A real
production setup would swap in a persistent store like `connect-redis` or
`connect-pg-simple` — out of scope for this assignment, but worth knowing
if asked in an interview.

### Alternative: separate hosts

The task also allows deploying the client and server separately (client on
Vercel/Netlify, server on Render/Railway) instead of the single-service
approach above. That needs a few changes this repo doesn't currently have:
CORS would need the server's `cors()` origin to allow the client's real
domain (already parameterized via `CLIENT_URL`, so this mostly just works),
the session cookie's `sameSite: "none"` path is already in place for
cross-origin production (see `server/src/index.ts`), and the client would
need `VITE_API_URL` actually wired into its `fetch()` calls (currently
unused, since the single-service approach never needed it) so it knows the
server's separate origin instead of relying on relative paths. The
single-service approach was chosen here for simplicity — one deploy, one
origin, nothing cross-site to get wrong.

## Project structure

```
sf-crud-app/
├── client/   # React + Vite + TypeScript
├── server/   # Express + TypeScript
├── .gitignore
└── README.md
```
