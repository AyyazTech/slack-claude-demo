# slack-claude-demo

Small Express service used as a sandbox for exploring Slack + Claude Code
workflows. It exposes a couple of routes, ships JWT auth middleware, and
talks to a local Postgres database.

## Requirements

- Node.js 18+
- Postgres 14+ running locally (or accessible via `PG*` env vars)

## Setup

```bash
npm install
cp .env.example .env   # fill in JWT_SECRET and PG* values
npm run dev            # starts the server with nodemon on :3000
```

## Environment variables

| Name           | Default               | Notes                          |
| -------------- | --------------------- | ------------------------------ |
| `PORT`         | `3000`                | HTTP port                      |
| `JWT_SECRET`   | `dev-secret-change-me`| Override in any real environment |
| `PGHOST`       | `localhost`           |                                |
| `PGPORT`       | `5432`                |                                |
| `PGUSER`       | `postgres`            |                                |
| `PGPASSWORD`   | `postgres`            |                                |
| `PGDATABASE`   | `slack_claude_demo`   |                                |

## Routes

- `GET /health` — liveness + DB reachability check
- `GET /users` — requires a `Bearer` JWT; returns the first 100 users

## Tests

```bash
npm test
```
