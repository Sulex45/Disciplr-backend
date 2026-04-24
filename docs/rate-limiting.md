# Rate Limiting

This document describes the rate-limiting strategy applied to high-risk endpoints in the Disciplr backend.

## Overview

Rate limiting is implemented with [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) and is layered in two places:

1. **Route-level limiters** — tight, endpoint-specific limits on the three highest-risk operations.
2. **Abuse-monitor middleware** — a broader IP-based sliding-window guard (`securityRateLimitMiddleware`) that runs on every request and emits structured security events.

All limiters return `429 Too Many Requests` with a JSON body:

```json
{
  "error": "Too many login attempts. Please try again later.",
  "retryAfter": 900
}
```

Standard `RateLimit-*` headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers) are included in every response.

---

## Protected endpoints

| Endpoint | Limiter | Window | Max requests | Key |
|---|---|---|---|---|
| `POST /api/auth/login` | `loginRateLimiter` | 15 min | 10 | IP (IPv6-normalized) |
| `POST /api/auth/*` (all auth routes) | `authRateLimiter` | 15 min | 20 | API key or IP |
| `POST /api/api-keys` | `apiKeyRateLimiter` | 15 min | 20 | API key or IP |
| `POST /api/jobs/enqueue` | `strictRateLimiter` | 60 min | 10 | API key or IP |
| `GET /api/health` | `healthRateLimiter` | 1 min | 30 | API key or IP |
| `GET/POST /api/vaults` | `vaultsRateLimiter` | 15 min | 50 | API key or IP |

### Key-generation strategy

- **`loginRateLimiter`** keys exclusively by IP (using `ipKeyGenerator` for correct IPv6 /56 subnet normalization). This prevents credential-stuffing attacks where an attacker rotates API keys but originates from the same IP.
- All other limiters key by `x-api-key` header when present, falling back to IP. This allows internal service-to-service calls that share an IP to be distinguished by their API key.

---

## Tuning thresholds

All thresholds are hard-coded in `src/middleware/rateLimiter.ts`. To change them, update the relevant `createRateLimiter` call and redeploy.

For the abuse-monitor thresholds (broader traffic analysis), see the environment variables documented in the [README](../README.md#abuse-detection-instrumentation).

---

## Internal service-to-service requests

Internal callers that need to bypass the per-IP limit should:

1. Include an `x-api-key` header with a service-specific key. This gives each service its own rate-limit bucket.
2. Ensure the key is provisioned via `POST /api/api-keys` before deployment.

The `loginRateLimiter` is IP-only and cannot be bypassed by API key. Internal services should not call `POST /api/auth/login` in hot paths.

---

## Abuse monitor integration

Every rate-limit breach triggers two side effects:

1. A `console.warn` log line tagged `[RATE_LIMIT_BREACH]` with IP, API key, method, path, and user-agent.
2. The `securityMetricsMiddleware` (running on every response) increments `failedLoginAttempts` for any `401`/`403` on `/auth` paths, and `securityRateLimitMiddleware` increments `rateLimitTriggers` for any request that exceeds the global sliding-window threshold.

The current snapshot is available at `GET /api/health/security`.

### Recommended alert policy

| Condition | Severity |
|---|---|
| Any `security.suspicious_pattern` log event | Warning |
| `security.rate_limit_triggered` > 20 times in 5 min from one IP | Critical |
| `[RATE_LIMIT_BREACH]` on `/api/auth/login` > 5 times in 1 min from one IP | Warning |

---

## Testing

Rate-limit behaviour is covered in `tests/rateLimit.test.ts`:

- 429 response and `retryAfter` body for login, API key creation, and job enqueue.
- `RateLimit-*` standard headers present on 429.
- IP-keyed isolation: different `x-api-key` values from the same IP share the login bucket.
- `console.warn` breach log emitted on every 429.
- `securityMetricsMiddleware` records `security.failed_login_attempt` on 401 from `/auth` paths.
- `getSecurityMetricsSnapshot` returns the expected shape.
- All `createRateLimiter` configuration branches (default key, API-key key, IP fallback).

Run with:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.js tests/rateLimit.test.ts
```
