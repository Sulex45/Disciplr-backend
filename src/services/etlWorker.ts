import { TransactionETLService } from '../services/transactionETL.js'
import type { ETLConfig } from '../types/transactions.js'

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

export interface ETLWorkerOptions {
  drainTimeoutMs?: number
}

export class ETLWorker {
  private readonly etlService: TransactionETLService
  private readonly drainTimeoutMs: number

  private interval: NodeJS.Timeout | null = null
  private isRunning = false
  private activeRun: Promise<void> | null = null
  private abortController: AbortController | null = null

  constructor(
    config: ETLConfig,
    options: ETLWorkerOptions = {},
    etlService?: TransactionETLService,
  ) {
    this.etlService = etlService ?? new TransactionETLService(config)
    this.drainTimeoutMs =
      typeof options.drainTimeoutMs === 'number' && options.drainTimeoutMs > 0
        ? options.drainTimeoutMs
        : DEFAULT_DRAIN_TIMEOUT_MS
  }

  /**
   * Start the ETL worker with periodic syncs
   */
  start(intervalMinutes = 5): void {
    if (this.isRunning) {
      console.log('ETL worker is already running')
      return
    }

    console.log(`Starting ETL worker with ${intervalMinutes} minute intervals`)
    this.isRunning = true

    // Kick off an immediate run
    this.executeRun()

    this.interval = setInterval(() => {
      this.executeRun()
    }, intervalMinutes * 60 * 1000)
  }

  /**
   * Stop the ETL worker gracefully.
   *
   * 1. Prevents any new runs from starting.
   * 2. Signals the current in-flight run to abort via AbortSignal.
   * 3. Waits up to `drainTimeoutMs` for the run to finish before returning.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    console.log('[ETLWorker] Stop requested – draining in-flight run...')
    this.isRunning = false

    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }

    // Ask the in-flight run to abort at its next checkpoint
    this.abortController?.abort()

    if (this.activeRun !== null) {
      const drain = this.activeRun.then(
        () => {},
        () => {},
      )
      const drainTimeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.warn(
            `[ETLWorker] Drain timeout (${this.drainTimeoutMs}ms) exceeded – proceeding with shutdown`,
          )
          resolve()
        }, this.drainTimeoutMs)
      })

      await Promise.race([drain, drainTimeout])
    }

    console.log('[ETLWorker] Stopped')
  }

  /**
   * Manually trigger an ETL run.
   * No-op if the worker is not running or a run is already active.
   */
  async runETL(): Promise<void> {
    if (!this.isRunning || this.activeRun !== null) {
      return
    }

    this.executeRun()

    // Await the run we just started so callers can know when it finishes
    if (this.activeRun !== null) {
      await this.activeRun
    }
  }

  /**
   * Returns observable state for health checks and metrics.
   */
  getStatus(): { isRunning: boolean; hasInterval: boolean; hasActiveRun: boolean } {
    return {
      isRunning: this.isRunning,
      hasInterval: this.interval !== null,
      hasActiveRun: this.activeRun !== null,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget run that tracks its own promise in `activeRun`.
   * Skips silently if not running or another run is already active.
   */
  private executeRun(): void {
    if (!this.isRunning || this.activeRun !== null) {
      return
    }

    this.abortController = new AbortController()
    const { signal } = this.abortController

    this.activeRun = this.etlService
      .runETL(signal)
      .catch((error: unknown) => {
        if (signal.aborted) {
          console.log('[ETLWorker] In-flight run aborted during shutdown')
        } else {
          console.error('[ETLWorker] Run failed:', error)
        }
      })
      .finally(() => {
        this.activeRun = null
        this.abortController = null
      })
  }
}


// Default configuration
const defaultConfig: ETLConfig = {
  horizonUrl: process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  networkPassphrase:
    process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  batchSize: 100,
  maxRetries: 3,
  backfillFrom: process.env.ETL_BACKFILL_FROM
    ? new Date(process.env.ETL_BACKFILL_FROM)
    : undefined,
  backfillTo: process.env.ETL_BACKFILL_TO
    ? new Date(process.env.ETL_BACKFILL_TO)
    : undefined,
}

export const etlWorker = new ETLWorker(defaultConfig)
