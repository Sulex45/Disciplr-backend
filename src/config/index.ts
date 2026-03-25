type AppConfig = {
  env: string
  port: number
  serviceName: string
  corsOrigins: string[] | '*'
}

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

/**
 * Resolves the list of allowed CORS origins from the CORS_ORIGINS env var.
 *
 * Production behaviour: if CORS_ORIGINS is not explicitly configured the
 * function returns an empty array (block all cross-origin requests) and emits a
 * structured warning so the misconfiguration is immediately visible in logs
 * rather than silently shipping an open API.
 *
 * Development / test behaviour: falls back to http://localhost:3000 so local
 * development works without requiring extra env setup.
 *
 * @param value  Raw CORS_ORIGINS env value (may be undefined).
 * @param env    Current NODE_ENV value.
 */
export function parseCorsOrigins(value: string | undefined, env: string): string[] | '*' {
  if (value !== undefined) {
    if (value.trim() === '*') return '*'
    return value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  }

  if (env === 'production') {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'security.cors_misconfiguration',
        service: 'disciplr-backend',
        message:
          'CORS_ORIGINS is not configured in production — all cross-origin requests will be blocked. Set CORS_ORIGINS to the allowed frontend origin(s).',
      }),
    )
    return []
  }

  // Outside production a sensible local-dev default avoids friction without
  // compromising prod security.
  return ['http://localhost:3000']
}

const _env = process.env.NODE_ENV ?? 'development'

export const config: AppConfig = {
  env: _env,
  port: parsePort(process.env.PORT, 3000),
  serviceName: process.env.SERVICE_NAME ?? 'disciplr-backend',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, _env),
}
