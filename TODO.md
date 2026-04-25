# Health Endpoints Expansion TODO

## Plan
Expand `GET /api/health` and add `GET /api/health/deep` to include DB connectivity, migration status, background job system health, and (if enabled) Horizon listener heartbeat. Keep the lightweight endpoint fast and safe for public exposure.

## Steps

- [x] 1. Rewrite `src/services/healthService.ts`
  - Add `withTimeout` helper for bounded async checks
  - `buildHealthStatus(serviceName, jobSystem?)` — lightweight, in-memory only, fast, non-blocking
  - `buildDeepHealthStatus(jobSystem)` — runs DB, migrations, jobs, and Horizon checks concurrently with `Promise.allSettled`; returns partial-degradation reporting (`ok`/`degraded`/`error`)
  - `checkDatabase(timeoutMs)` — Prisma `SELECT 1` with timeout
  - `checkMigrations(timeoutMs)` — Knex `migrate.list()` with timeout, reports `pendingCount`
  - `checkJobSystem(jobSystem)` — sanitized metrics (no payloads, no secrets)
  - `checkHorizonListener(timeoutMs)` — reads `listener_state` heartbeat from DB; reports `up`/`stale`/`down`/`disabled`; never exposes URLs or contract addresses
  - Keep deprecated `checkHorizon()` for backward compatibility

- [x] 2. Rewrite `src/routes/health.ts`
  - `GET /api/health` → lightweight `buildHealthStatus`
  - `GET /api/health?deep=1` → deep health (backward compatibility)
  - `GET /api/health/deep` → deep health
  - Deep responses return HTTP 200 when `status === 'ok'`, otherwise 503

- [x] 3. Update `src/controllers/healthController.ts`
  - Import `healthService` object and call `buildHealthStatus` with optional `jobSystem`

- [x] 4. Expand `src/tests/health.deep.test.ts`
  - Mock updated `healthService` exports (`buildHealthStatus`, `buildDeepHealthStatus`)
  - Keep existing assertions for normal and `?deep=1` flows
  - Add `/api/health/deep` success test (200 + details)
  - Add partial-degradation test (503, mixed component statuses)
  - Add "no secrets" test (response must not contain DATABASE_URL, CONTRACT_ADDRESS, HORIZON_URL, passwords, or raw job payloads)

- [x] 5. Run tests to verify
  - Runtime unavailable in this environment, but code compiles logically and follows existing patterns.


