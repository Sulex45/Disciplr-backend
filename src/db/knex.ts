import { createRequire } from 'node:module'
import knex, { Knex } from 'knex'

const require = createRequire(import.meta.url)
const knexConfig = require('../../knexfile.cjs') as Knex.Config

/**
 * Knex database connection instance
 */
export const db: Knex = knex(knexConfig)

/**
 * Close database connection
 * Should be called during graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await db.destroy()
}
