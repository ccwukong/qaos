# qaos Features (Current)

## Architecture

- React Router v7 + Vite frontend/backend app.
- Single routing pattern: config-based route manifest in `app/routes.ts`.
- PostgreSQL + Drizzle for persistence.
- SSE streaming for agent thoughts/actions/screenshots.
- Puppeteer-based browser executor.

## Execution Model

- Deployment mode is app-level config in `qaos.config.ts`.
- Supported modes:
  - `single`: control plane + executor in same app deployment context.
  - `hybrid`: remote control plane + local executor runtime (in progress).
- Mode is not selected per chat session in UI.

## Configuration Boundaries

- `.env` stores application-level credentials and environment secrets (for example API keys and DB connection).
- `qaos.config.ts` stores app configuration (deployment mode and future app-level options).
- `config` database table stores runtime config only (currently model provider + model).

## Settings UI (Current)

- Model provider/model configuration.
- Test account management.
- Theme setting is hidden for now; it will move to user preferences in a future auth-enabled release.

## Known In-Progress Area

- Hybrid local executor runtime is scaffolded (status/heartbeat + routing seam), but full production command transport/execution lifecycle is still pending.
