# sf-crud-app

Full-stack CRUD app scaffold.

- `server/` — Node.js + Express + TypeScript API
- `client/` — React + Vite + TypeScript frontend

## Getting started

Install dependencies for the root, server, and client:

```bash
npm install
npm install --prefix server
npm install --prefix client
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
npm run lint:server    # lint server
npm run lint:client    # lint client
```

## Project structure

```
sf-crud-app/
├── client/   # React + Vite + TypeScript
├── server/   # Express + TypeScript
├── .gitignore
└── README.md
```
