import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config } from './config/index.js'
import { privacyLogger } from './middleware/privacy-logger.js'

export const app = express()

app.use(helmet())

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Non-browser / server-to-server requests carry no Origin header — pass through
    if (!origin) {
      callback(null, true)
      return
    }

    const allowed = config.corsOrigins
    if (allowed === '*' || (Array.isArray(allowed) && allowed.includes(origin))) {
      callback(null, true)
    } else {
      // Emit a structured log so rejected origins are observable in prod logs
      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'security.cors_rejected',
          service: 'disciplr-backend',
          origin,
          timestamp: new Date().toISOString(),
        }),
      )
      callback(null, false)
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'idempotency-key'],
  credentials: true,
}

app.use(cors(corsOptions))
app.use(express.json())

app.use((_req, res, next) => {
  res.setHeader('X-Timezone', 'UTC')
  next()
})

app.use(privacyLogger)

// Routes are mounted in index.ts
