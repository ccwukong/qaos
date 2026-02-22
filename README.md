<div align="center">
  <img src="app/public/logo.svg" alt="qaos logo" width="120" />
  <h1>qaos</h1>
  <p>
    <a href="https://github.com/ccwukong/qaos/actions/workflows/test.yml"><img src="https://github.com/ccwukong/qaos/actions/workflows/test.yml/badge.svg" alt="CI Status"></a>
  </p>
  <p><strong>/ˈkeɪ.ɒs/</strong> (rhymes with “chaos”)</p>
  <p><strong>An Open Source AI QA Co-founder.</strong></p>
</div>

qaos is a storytelling-style QA workspace: you describe what to test, the agent explores a real browser, and the session becomes a reusable test artifact.

---

## Table of Contents

- [A Short Story of One Test](#a-short-story-of-one-test)
- [Quick Start](#quick-start)
- [Run with Docker (Recommended Local Stack)](#run-with-docker-recommended-local-stack)
- [Routing Pattern](#routing-pattern)
- [Execution Modes](#execution-modes)
- [Where Things Run (Control Plane vs Executor)](#where-things-run-control-plane-vs-executor)
- [Deployment Playbooks](#deployment-playbooks)
- [How qaos Works](#how-qaos-works)
- [Settings & Test Accounts](#settings--test-accounts)
- [Environment Variables](#environment-variables)
- [Database, Migrations & Seeding](#database-migrations--seeding)
- [Built-in Skills](#built-in-skills)
- [Project Structure](#project-structure)
- [Contributing Skills](#contributing-skills)
- [License](#license)

---

## A Short Story of One Test

1. You open qaos and type: “Go to `https://example.com` and test signup.”
2. The agent launches a browser session, reasons step-by-step, and streams thoughts/actions.
3. You watch screenshots in the live canvas, intervene if needed, and refine the flow.
4. You export the final test case or replay it after UI changes.

That’s the product: conversational testing that ends in reproducible QA assets.

---

## Quick Start

```bash
# 1) Install deps
npm install

# 2) Create env file
cp .env.example .env

# 3) Start dev server
npm run dev
```

Open http://localhost:5173.

---

## Run with Docker (Recommended Local Stack)

Use this when you want reproducible local runtime + PostgreSQL:

```bash
docker compose up --build
```

Then initialize DB once:

```bash
docker compose exec app npm run db:setup
```

Open http://localhost:5173.

Stop everything:

```bash
docker compose down
```

Default services:

- `qaos-app` on `5173`
- `qaos-db` on `5432`

---

## Routing Pattern

qaos uses **one routing pattern**: config-based routing.

- Route registration source of truth: `app/routes.ts`.
- Handler implementations live in `app/handlers/pages/` (UI pages) and `app/handlers/api/` (API endpoints), referenced by `app/routes.ts`.
- Do not mix in file-based auto-routing conventions.

---

## Execution Modes

Execution mode is application-level and configured in `qaos.config.ts`.

- **Single-node Mode**: the browser execution runtime (Puppeteer session that performs page actions, DOM checks, and screenshots) runs inside the same qaos app deployment unit/process context.
  - Practical behavior: this is usually **headless** in production because many VPS/containers have no X display.
  - Not a hard rule: single-node mode can run headed if the host provides a display stack (for example Xvfb/desktop session).
  - Runtime safety: when Linux has no display, qaos falls back/retries with headless to avoid launch failure.
  - Practical caveat: single-node mode is often not ideal for difficult CAPTCHA / aggressive anti-bot challenges, especially when human-in-the-loop solving or device-local context is required.
- **Hybrid Mode**: intended to run that same browser execution runtime on your own machine via a local executor process, while control plane stays in qaos server.
  - Good fit for localhost/private-network testing and desktop-bound auth/session flows.
  - Also the better long-term fit for CAPTCHA-sensitive flows once the local executor runtime is fully implemented.
  - Today, qaos will show status and connectivity warnings if no local executor is connected.

`qaos.config.ts` example:

```ts
export const qaosConfig = {
  deploymentMode: 'single', // "single" | "hybrid"
}
```

- Default today: `single` (fully wired and production-ready in the current codebase).
- First-run behavior: when you clone qaos and run locally (`npm run dev` or `docker compose up`), control plane + executor run together, so you are in Single-node Mode by default.
- Hybrid mode only applies after you deploy the control plane remotely and connect a local executor runtime from your machine.
- For CAPTCHA-sensitive or device-local flows, prefer hybrid execution once local executor runtime is fully available.

---

## Where Things Run (Control Plane vs Executor)

Imagine qaos as two characters working together:

- **Control Plane**: planning, memory, APIs, stream updates, exports/replay.
- **Executor**: the runtime that actually drives a browser and performs actions.

### In the current codebase

- **Single-node Mode is ready now**: the browser executor runs in the same environment as qaos server.
- **Hybrid Mode is marked “in progress”** because the control-plane plumbing exists, but the real local runtime that executes browser actions has not been fully wired yet.

So if you deploy qaos to a VPS today, the browser also runs on that VPS.

### Why “Hybrid Mode” is currently “in progress”

What exists already:

- Mode router + adapter seam.
- Local executor status + heartbeat APIs.

What is still missing:

- A production local executor process that maintains a long-lived connection to qaos.
- Action transport/execution loop for real browser commands and streamed results.

Current implication:

- Hybrid Mode is currently infrastructure scaffolding and connectivity signaling, not full end-to-end browser execution yet.

### End-to-end example: how Agent, Skill, and Executor collaborate

User request:

- “Test signup on `https://example.com`, complete registration, and verify email field validation.”

1. **Agent (decision layer)**

- Interprets intent and creates a plan: open page, start signup, fill fields, submit invalid email, verify error message, retry with valid email.
- Chooses a reusable skill if useful (for example registration/login patterns).

2. **Skill (playbook layer)**

- Provides structured guidance (what to check, common selectors, expected outcomes, guardrails).
- May call helper scripts for deterministic sub-steps (for example data transform/validation helpers).
- Does not directly drive the browser.

3. **Executor (action layer)**

- Receives concrete browser actions from the agent and performs them: navigate, click, type, inspect DOM, capture screenshots.
- Returns observations/results (page state, element presence, error text, screenshots) back to the agent.

4. **Agent (feedback loop)**

- Evaluates executor results, decides pass/fail for each step, and chooses the next action.
- If something unexpected happens, it can switch strategy, reuse another skill pattern, or ask for intervention.

What changes by mode:

- **Single-node Mode**: executor runs with the qaos app deployment unit/process context.
- **Hybrid Mode (target)**: the same executor responsibilities run on your machine via a local executor runtime.

One-line mental model:

- **Agent = brain**, **Skill = playbook**, **Executor = hands in the browser**.

### Production-Ready Local Executor Plan

To make Hybrid Mode production-ready, implement the following phases:

1. **Transport + identity handshake**

- Add persistent bidirectional channel (WebSocket or equivalent).
- Introduce executor registration/authentication (executor ID, token, version, capabilities).

2. **Command protocol + lifecycle control**

- Implement command dispatch: assign run, execute action, return observation.
- Add timeout/cancel/retry semantics with idempotent command IDs.

3. **Reliability + supervision**

- Add heartbeat TTL, reconnect logic, and stale-executor eviction.
- Run local executor under a supervised process model with restart/backoff.

4. **Security hardening**

- Sign/encrypt control-plane ↔ executor traffic.
- Restrict allowed origins/targets, redact secrets, and gate sensitive actions.

5. **Observability + operability**

- Add structured logs, run-level tracing, and key metrics (success rate, latency, reconnects).
- Surface executor health and version drift in UI/API.

6. **Release readiness**

- Add end-to-end tests for happy path, reconnect, crash recovery, timeout, and cancellation.
- Publish deploy/runbook docs for remote control plane + local executor setup.

---

## Deployment Playbooks

### Playbook A — Single-node mode deployment (default first-run and current stable path)

This is what you get by default in first-run local dev/docker, and also in single-host remote deployments.

Deploy these components together in one environment (local or remote):

1. qaos app server
2. PostgreSQL
3. migration/seed step (`npm run db:setup`)
4. secrets/env vars (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`, ...)

Use:

```ts
# in qaos.config.ts
deploymentMode: "single"
```

### Playbook B — Fully local run (dev workflow)

```bash
npm install
cp .env.example .env
npm run dev
```

or Docker:

```bash
docker compose up --build
docker compose exec app npm run db:setup
```

### Playbook C — Hybrid mode deployment (target architecture)

This is the direction currently under refactor. The last missing piece is a local executor process that connects back to qaos (heartbeat + action transport). Until that is shipped, use Playbook A or B.

Current local-executor scaffolding available now:

- `GET /api/executor/status` → returns local executor connectivity status.
- `POST /api/executor/heartbeat` → updates connectivity heartbeat.
  - body `{"connected": true}` (or empty body) marks connected.
  - body `{"connected": false}` marks disconnected.

Quick manual simulation:

```bash
# Mark local executor as connected
curl -X POST http://localhost:5173/api/executor/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"connected":true}'

# Check status
curl http://localhost:5173/api/executor/status

# Mark disconnected
curl -X POST http://localhost:5173/api/executor/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"connected":false}'
```

---

## How qaos Works

Think of qaos as two loops running together:

- **Reasoning loop** (LLM): decide the next best action.
- **Execution loop** (browser): perform one action, capture new state, feed back to reasoning.

Core stack:

- **Frontend**: React Router v7 + Vite + Tailwind v4
- **Backend**: Node.js + TypeScript + PostgreSQL + Drizzle
- **Automation**: Puppeteer (with stealth plugin)
- **Streaming**: Server-Sent Events (SSE)

---

## Settings & Test Accounts

In **Settings**, you can configure:

- Model provider + model
- Test accounts

Theme configuration is temporarily hidden and will move to a future user-preference system.

Test accounts are session-scoped:

- You assign one account per test session.
- The LLM only sees account metadata (id/key context).
- Secret values are typed server-side via secure actions, not injected into prompts.

---

## Environment Variables

| Variable              | Description                            | Default                                              |
| :-------------------- | :------------------------------------- | :--------------------------------------------------- |
| `OPENAI_API_KEY`      | OpenAI API key                         | -                                                    |
| `OPENROUTER_API_KEY`  | OpenRouter API key                     | -                                                    |
| `DATABASE_URL`        | PostgreSQL connection string           | `postgresql://postgres:postgres@localhost:5432/qaos` |
| `HEADLESS`            | Puppeteer mode (`false` = headed)      | `true`                                               |
| `DISABLE_SCREENSHOTS` | Disable screenshot capture when `true` | `true`                                               |

Note for Docker users: `docker-compose.yml` may override env values for container runtime.

Deployment mode is configured in `qaos.config.ts`, not `.env`.

---

## Database, Migrations & Seeding

qaos requires PostgreSQL.

Example:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qaos"
```

Migration + seed commands:

```bash
npm run db:migrate
npm run db:seed
# or
npm run db:setup
```

Migration files live in `app/db/drizzle/`.
Applied migrations are tracked in `qaos_migrations`.

---

## Built-in Skills

- `standard-login`
- `standard-registration`
- `standard-math`
- `stripe-checkout`
- `csv-test-import`

Skills use AgentSkills-style metadata/instructions and can include executable scripts + JSON schemas.

---

## Project Structure

```text
.
├── app/
│   ├── db/
│   │   ├── drizzle/
│   │   └── scripts/
│   ├── public/
│   ├── handlers/
│   │   ├── pages/
│   │   │   ├── home.tsx
│   │   │   ├── test-session.tsx
│   │   │   ├── settings.tsx
│   │   │   └── replay.tsx
│   │   └── api/
│   │       ├── test-session.tsx
│   │       ├── executor-status.tsx
│   │       ├── executor-heartbeat.tsx
│   │       ├── export-session.tsx
│   │       ├── replay.tsx
│   │       ├── stop-session.tsx
│   │       ├── settings-session.tsx
│   │       └── message.tsx
│   ├── services/
│   │   ├── agent.server.ts
│   │   ├── browser.server.ts
│   │   ├── execution-adapter.server.ts
│   │   ├── executor-protocol.ts
│   │   ├── executor-router.server.ts
│   │   ├── local-execution-adapter.server.ts
│   │   ├── local-executor-registry.server.ts
│   │   ├── skills.server.ts
│   │   └── sse.server.ts
│   ├── tests/
│   ├── app.css
│   ├── root.tsx
│   └── routes.ts
├── docs/
├── skills/
├── templates/
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## Contributing Skills

To create a new skill:

1. Copy `templates/sample-skill/` to `skills/<your-skill-name>/`
2. Add YAML frontmatter (`name`, `description`) in `SKILL.md`
3. Write clear trigger conditions, negative triggers, and steps
4. Optionally add:
   - `scripts/*.ts` executable helpers
   - `assets/*.json` schemas for script args
   - references/docs

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

If qaos helps your team, a link back to this repository is appreciated.
