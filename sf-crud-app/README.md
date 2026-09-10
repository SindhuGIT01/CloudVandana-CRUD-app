# sf-crud-app

Full-stack CRUD app for Salesforce, plus a natural-language **Salesforce Ops
Agent** on top of the same endpoints (see the section below).

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

## Salesforce Ops Agent

A natural-language layer over the same CRUD endpoints. Instead of picking an
object and filling in a form, you type a request — *"close all opportunities
older than 90 days with no activity"* — and an LLM agent (Anthropic Claude)
plans it, calls the existing Salesforce REST operations, and reports back in
plain English.

It is **purely additive**: one route (`POST /api/agent/chat`), one optional
env var, no change to the OAuth or CRUD code. With `ANTHROPIC_API_KEY` unset
the agent replies that it isn't configured and the rest of the app is
unaffected. UI lives at **`/agent`** (linked from the dashboard).

### Enabling it

Add to `server/.env`, then restart the server:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at <https://console.anthropic.com/settings/keys>.

### Architecture

Three pieces, all under `server/src/agent/`.

**1. Tool definitions (`tools.ts`)** — each CRUD capability described in
Anthropic's tool-calling schema so the model can invoke it:

| Tool | Backend call |
|---|---|
| `search_records(object, filters[], order_by, fields[], limit)` | SOQL `SELECT … WHERE … ORDER BY … LIMIT` |
| `get_record(object, id, fields[])` | SOQL by Id |
| `create_record(object, fields{})` | `POST /sobjects/{object}` |
| `update_record(object, id, fields{})` | `PATCH /sobjects/{object}/{id}` |
| `delete_record(object, id)` | `DELETE /sobjects/{object}/{id}` |
| `update_records(object, ids[], fields{})` | one PATCH per Id (≤ 200), failures isolated |
| `delete_records(object, ids[])` | one DELETE per Id (≤ 200), failures isolated |

Executors (`executeTool.ts`) call the existing `services/salesforceApi.ts`
helpers **in-process** — no HTTP self-calls — reusing the access token that
`requireAuth` already validated and refreshed for the request, so the agent
can never run without an authenticated Salesforce session. Object names are
checked against the allow-list; field names and record Ids are validated with
the same patterns the REST routes use; string filter values are quoted and
escaped before they enter SOQL (`validation.ts`).

**2. Reasoning loop (`runAgent.ts`)** — a manual tool-use loop:

1. Send the user message + tool definitions + a system prompt to Claude
   (`claude-opus-5`, adaptive thinking).
2. If Claude returns text (`stop_reason !== "tool_use"`), that is the answer.
3. Otherwise execute each requested tool, feed the results back as
   `tool_result` blocks, and loop.

The system prompt directs the model to work **search → decide → act**: let
Salesforce filter, work out which Ids actually match the intent, then act on
the whole set in one bulk call. Capped at 20 Claude↔tool round trips; if every
tool call fails for three turns straight the run aborts with the last error
instead of exhausting the budget.

**3. Confirmation step** — before any `update_*` / `delete_*` executes, the
loop stops, stashes the transcript on the session, and returns a preview built
**from the tool arguments, not from what the model claims**:

```
This will change your Salesforce data:
- Delete 3 Lead records: 00Q…, 00Q…, 00Q…
Reply "yes" to proceed or "no" to cancel.
```

The next message resumes it: *yes* runs the stashed calls and continues the
loop; *no* feeds a "user declined" result back so the model acknowledges;
anything unclear re-shows the preview. A pending action expires after 15
minutes. Read-only tools never pause. The client shows **Yes / No** buttons
while a confirmation is pending.

### Error handling

- Anthropic API failures (rejected key, rate limit, overload, network) map to
  specific messages, not a generic 500.
- A Salesforce `401` / `INVALID_SESSION_ID` mid-loop aborts the request with
  `sessionExpired: true` so the client can prompt a re-login.
- Invalid SOQL / unknown field names return to the model as `{ error }`; the
  prompt says retry once if the fix is obvious, otherwise explain and stop.
- Ambiguous requests get one clarifying question — the agent never invents an
  object, record, or field value.

### Files

```
server/src/agent/
├── tools.ts        # tool definitions (Anthropic schema) + DESTRUCTIVE_TOOLS
├── executeTool.ts  # executors -> services/salesforceApi.ts; SOQL build + validation
├── validation.ts   # field-name / Id patterns, SOQL string escaping
└── runAgent.ts     # reasoning loop + confirmation gate + error handling
server/src/routes/agent.ts               # POST /api/agent/chat
client/src/pages/AgentChat.tsx           # chat UI
client/src/hooks/useAgentChat.ts         # transcript state + fetch
client/src/components/AgentMarkdown.tsx  # tiny Markdown renderer for replies
```

`AGENT_TEST_CONVERSATIONS.md` has worked end-to-end examples (simple read,
filtered bulk update, confirmation, ambiguous request).

### Limitations

- Pending confirmations live in the in-memory session — a server restart drops
  them (just re-issue the request).
- Bulk tools loop single-record REST calls rather than using Salesforce's
  composite/collections endpoint — simpler and failure-isolated, fine for the
  record counts here.
- One conversation per session; the transcript is not persisted across page
  loads.

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
| `ANTHROPIC_API_KEY` | Optional. Enables the Salesforce Ops Agent; leave unset and the rest of the app works unchanged. Keep secret |

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
├── server/   # Express + TypeScript (CRUD API + Salesforce Ops Agent under src/agent/)
├── AGENT_TEST_CONVERSATIONS.md
├── .gitignore
└── README.md
```
