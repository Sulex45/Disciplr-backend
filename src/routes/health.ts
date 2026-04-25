import { Router } from 'express'
import { BackgroundJobSystem } from '../jobs/system.js'
import { healthService } from '../services/healthService.js'
import { config } from '../config/index.js'

export const createHealthRouter = (jobSystem: BackgroundJobSystem) => {
  const router = Router()

  router.get('/', async (req, res) => {
    const isDeep = req.query.deep === '1'

    if (isDeep) {
      const health = await healthService.buildDeepHealthStatus(jobSystem)
      const statusCode = health.status === 'ok' ? 200 : 503
      res.status(statusCode).json(health)
      return
    }

    const health = healthService.buildHealthStatus(config.serviceName, jobSystem)
    res.json(health)
  })

  router.get('/deep', async (_req, res) => {
    const health = await healthService.buildDeepHealthStatus(jobSystem)
    const statusCode = health.status === 'ok' ? 200 : 503
    res.status(statusCode).json(health)
  })

  return router
}

