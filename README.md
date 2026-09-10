# Salesforce CRUD App with AI Ops Agent

A full-stack web app for managing Salesforce records through a normal CRUD dashboard **and** through a natural-language chat agent that plans and executes Salesforce operations on your behalf.

---

## Aim / Purpose

This project was built to practice production-shaped full-stack development end to end:

- **OAuth 2.0 integration with a real third-party API** (Salesforce) — the Web Server flow with PKCE, refresh tokens, and session management, with no user password ever touching the app.
- **A typed REST backend** that treats Salesforce as its database instead of running one locally.
- **An AI agent feature** — wrapping existing backend capabilities as LLM "tools" and letting Anthropic's Claude decide which to call, with a human-in-the-loop confirmation step before anything destructive runs.
- **Security guardrails** around dynamically built SOQL and around what the agent is allowed to do.

The AI layer is deliberately **additive**: one route, one optional environment variable, and the classic CRUD app keeps working unchanged if no API key is set.

---

## Features

### Salesforce CRUD dashboard
- **Log in with Salesforce** — OAuth 2.0 Web Server flow + PKCE; the app only ever holds tokens, never credentials.
- **Browse records** for the supported objects — Account, Opportunity, Lead, Contact, Case.
- **Pick which fields to show** (backed by a live Salesforce "describe" call) and get a **paginated, infinite-scroll table**.
- **Create, edit, and delete** records through a modal form, with delete confirmation and success/error toasts.
- **Automatic token refresh** — the access token is refreshed before it expires; a dead session returns a clean 401.

### Salesforce Ops Agent (natural-language layer)
- A **chat interface** (`/agent`) where you type requests like *"show me the 5 newest opportunities"* or *"close every stale lead from the Web source"*.
- Claude runs a **manual tool-use loop** over seven tools that map to the existing Salesforce REST operations:
  `search_records`, `get_record`, `create_record`, `update_record`, `delete_record`, plus bulk `update_records` / `delete_records`.
- A **search → decide → act** pattern: filter server-side, work out which records actually match, then act on the whole set in one bulk call.
- **Confirmation gate** — before any update or delete, the loop pauses and shows a preview built from the actual tool arguments (*"This will change your Salesforce data: Delete 3 Lead records…"*). Nothing runs until you reply **yes**.
- **Readable replies** — a small Markdown renderer turns Claude's answers into formatted text instead of raw JSON.
- **Layered error handling** — specific messages for a rejected/expired Anthropic key, an out-of-credits account, a Salesforce session that dies mid-request, invalid SOQL, and ambiguous requests (the agent asks one clarifying question rather than guessing).

### Security guardrails
- **Object allow-list** — only Account / Opportunity / Lead / Contact / Case are reachable through the API.
- **SOQL injection protection** — field names and record Ids are validated against strict regexes before they're interpolated into a query; string filter values are quoted and escaped (`server/src/agent/validation.ts`, mirrored in `routes/records.ts`).
- **`httpOnly`, signed session cookie**; `secure` + `sameSite=none` in production behind a trusted proxy.
- **Agent runs in-process** with the authenticated session — no HTTP self-calls, no way to reach objects the REST routes don't allow.
- **Bounded agent** — bulk operations capped at 200 records per call; the reasoning loop is capped at 20 iterations and aborts after repeated tool errors.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, React Router 7, Vite 8, TypeScript |
| **Backend** | Node.js, Express 4, TypeScript, `tsx` (dev runner), `express-session` |
| **Auth** | Salesforce OAuth 2.0 (Web Server Flow + PKCE), refresh tokens |
| **Data source** | Salesforce REST API v61.0 (SOQL queries + sObject endpoints) — **no local database** |
| **AI** | Anthropic SDK (`@anthropic-ai/sdk` `^0.124`), model `claude-opus-5`, tool-calling API with adaptive thinking |
| **Tooling** | ESLint 9 (flat config) + `typescript-eslint`, `concurrently` |

---

## Architecture / How It Works

```
Landing page
   │  "Log in with Salesforce"
   ▼
GET /auth/login ──▶ Salesforce authorize (OAuth 2.0 + PKCE, state check)
   │
   ▼
GET /auth/callback ──▶ exchange code for tokens ──▶ store { accessToken,
   │                     refreshToken, instanceUrl } in the server session
   ▼
/dashboard  ──▶  pick object + fields
   │
   ├─▶ GET /api/records/:object   → server builds SOQL → Salesforce REST → table
   ├─▶ POST /api/records/:object  → create
   ├─▶ PATCH /api/records/:object/:id → update
   └─▶ DELETE /api/records/:object/:id → delete

/agent  ──▶  "close all opportunities older than 90 days with no activity"
   │
   ▼
POST /api/agent/chat ──▶ runAgent()
   │   ├─ send message + 7 tool definitions + system prompt to Claude
   │   ├─ Claude calls tools; executors hit the SAME Salesforce REST helpers in-process
   │   ├─ any update/delete → pause, return a preview, wait for "yes"
   │   └─ feed results back until Claude returns a plain-English answer
   ▼
{ reply, awaitingConfirmation?, sessionExpired? }
```

Every `/api/*` request except `/api/health` passes through the `requireAuth` middleware, which refreshes the Salesforce access token when it's near expiry and returns 401 if the session is gone.

---

## Project Structure

```
CloudVandana-CRUD-app/
└── sf-crud-app/
    ├── client/                       # React + Vite frontend
    │   └── src/
    │       ├── pages/                # LandingPage, Dashboard, AgentChat
    │       ├── components/           # Header, RecordsTable, RecordFormModal,
    │       │                         #   FieldPicker, AgentMarkdown, ProtectedRoute, …
    │       └── hooks/                # useAuthStatus, useAgentChat,
    │                                 #   useInfiniteRecords, useObjectFields, useToasts
    ├── server/                       # Express + TypeScript API
    │   └── src/
    │       ├── auth/                 # Salesforce OAuth 2.0 + PKCE, session typing
    │       ├── routes/               # auth, objects, records, agent
    │       ├── services/             # salesforceApi.ts — REST wrapper + error shaping
    │       ├── middleware/           # requireAuth — session guard + token refresh
    │       ├── agent/                # tools.ts, executeTool.ts, runAgent.ts, validation.ts
    │       └── config/               # env, constants (API version, allowed objects)
    ├── README.md                     # detailed deployment + agent architecture notes
    └── AGENT_TEST_CONVERSATIONS.md   # scripted end-to-end test conversations
```

---

## Setup & Installation

### Prerequisites
- Node.js 20.19+ (Vite 8 / React 19)
- A Salesforce org with an **External Client App / Connected App** configured for the OAuth Web Server flow (scopes must include `refresh_token` / `offline_access`), with `http://localhost:4000/auth/callback` in its Callback URLs.
- *(Optional)* an Anthropic API key for the Ops Agent.

### Steps

```bash
git clone https://github.com/SindhuGIT01/CloudVandana-CRUD-app.git
cd CloudVandana-CRUD-app/sf-crud-app

# installs root, client, and server dependencies (postinstall hook)
npm install

# create the server env file and fill it in
cp server/.env.example server/.env

# run client (:5173) and server (:4000) together
npm run dev
```

Open **http://localhost:5173**.

### Environment variables (`server/.env`)

| Key | Purpose |
|---|---|
| `CLIENT_URL` | Client origin, e.g. `http://localhost:5173` — post-login redirect + CORS origin |
| `CLIENT_ID` | Salesforce External Client App consumer key |
| `CLIENT_SECRET` | Salesforce External Client App consumer secret |
| `REDIRECT_URI` | OAuth callback URL — must exactly match one on the External Client App (e.g. `http://localhost:4000/auth/callback`) |
| `SF_LOGIN_URL` | `https://login.salesforce.com`, `https://test.salesforce.com`, or your My Domain URL |
| `SESSION_SECRET` | Random string used to sign the session cookie (e.g. `openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | *Optional.* Enables the Ops Agent; leave blank and the CRUD app works unchanged |
| `NODE_ENV` | Set to `production` to serve the built client and enable secure cross-site cookies; unset for local dev |
| `PORT` | Server port (defaults to `4000`) |

### Other scripts (run from `sf-crud-app/`)

```bash
npm run build       # build client, then compile server — the production build
npm start           # run the production build
npm run lint        # lint client + server
```

---

## API Endpoints

All routes are served by the Express server. Everything under `/api/*` (except `/api/health`) requires an authenticated Salesforce session.

### Auth
| Method | Route | Description |
|---|---|---|
| `GET` | `/auth/login` | Start the Salesforce OAuth flow (sets `state` + PKCE verifier, redirects to Salesforce) |
| `GET` | `/auth/callback` | OAuth redirect target — verifies `state`, exchanges the code for tokens, stores the session, redirects to `/dashboard` |
| `GET` | `/auth/status` | `{ "authenticated": boolean }` — polled by the client, no token refresh |
| `GET` | `/auth/logout` | Destroys the session and clears the cookie |

### Records & metadata
| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | `{ "status": "ok" }` — unauthenticated health check |
| `GET` | `/api/objects/:objectName/fields` | Salesforce "describe" for an object, simplified to `{ name, label, type, updateable, createable }[]` |
| `GET` | `/api/records/:objectName?fields=&limit=&offset=` | Run a SOQL query for the object; returns `{ totalSize, limit, offset, records }` |
| `POST` | `/api/records/:objectName` | Create a record from a JSON body of field values |
| `PATCH` | `/api/records/:objectName/:id` | Update a record |
| `DELETE` | `/api/records/:objectName/:id` | Delete a record |

### Agent
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agent/chat` | Body `{ "message": string }` → `{ reply, awaitingConfirmation?, sessionExpired? }`. Runs the Claude tool-use loop; a follow-up `"yes"` / `"no"` resumes a pending destructive action |

---

## Live Demo

The app is built to deploy as a **single service on Render** — the Express server serves both the API and the built React client, so there's one URL and one origin. Full deployment steps (Render config, environment variables, updating the Salesforce Callback URL) are in [`sf-crud-app/README.md`](sf-crud-app/README.md).

> **Live URL:** _add your Render URL here once deployed_

---

## Future Improvements

- **Persistent session store** — sessions currently use `express-session`'s in-memory `MemoryStore`, so logins don't survive a server restart and it can't scale past one instance. Swap in `connect-redis` or `connect-pg-simple`.
- **Automated test coverage** — the agent has scripted end-to-end conversations in `AGENT_TEST_CONVERSATIONS.md` but no test runner. Add Vitest with mocked Salesforce and Anthropic clients so the tool executors and confirmation flow are covered in CI.
- **Reasoning-loop enhancements** — stream the agent's response into the chat UI as it's generated, and persist multi-turn conversation history across page loads (today each message starts a fresh transcript).
- **True bulk operations** — the bulk agent tools loop single-record REST calls; switching to Salesforce's composite / sObject Collections API would cut them to one request.

---

## License

Built as a learning project. No license specified.
