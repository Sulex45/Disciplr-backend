# Requirements Document

## Introduction

This feature adds a Dead-Letter Queue (DLQ) to the existing export pipeline in `src/services/exportQueue.ts`. When an export job fails after exhausting all retry attempts, the ExportQueue shall move it to the DLQ with a structured failure record that captures the reason, attempt count, and sanitised context — without leaking PII. An optional metrics hook lets operators observe DLQ depth and failure rates. The DLQ is queryable and drainable (manual re-queue or discard) via internal service methods, keeping the API surface stable and the implementation confined to the backend.

---

## Glossary

- **ExportQueue**: The in-process service defined in `src/services/exportQueue.ts` that creates, processes, and tracks export jobs.
- **ExportJob**: A single unit of work tracked by `ExportJob` interface; has a lifecycle of `pending → running → done | failed`.
- **DLQ (Dead-Letter Queue)**: An in-memory store of `DlqEntry` records representing export jobs that have permanently failed.
- **DlqEntry**: A structured record stored in the DLQ containing job metadata, failure reason, attempt count, and timestamps — no PII fields.
- **FailureReason**: A string enum classifying why a job was moved to the DLQ (e.g. `serialization_error`, `data_fetch_error`, `unknown_error`).
- **MetricsHook**: An optional callback `(event: DlqMetricsEvent) => void` supplied at construction time; called on DLQ mutations.
- **DlqMetricsEvent**: A plain object emitted to the MetricsHook describing the event type and non-PII counters/labels.
- **Sanitised context**: Job metadata with PII fields (`userId`, `targetUserId`) replaced by opaque tokens before storage or emission.

---

## Requirements

### Requirement 1: DLQ Entry Creation on Permanent Failure

**User Story:** As a backend engineer, I want failed export jobs to be moved to a DLQ with a structured failure record, so that I can inspect and remediate them without losing context.

#### Acceptance Criteria

1. WHEN an export job transitions to `failed` status, THE ExportQueue SHALL create a `DlqEntry` containing: `jobId`, `jobType` (scope + format), `failureReason`, `errorMessage`, `attemptCount`, `failedAt` (ISO-8601 UTC), and `sanitisedContext`.
2. THE ExportQueue SHALL classify the `failureReason` as one of: `serialization_error`, `data_fetch_error`, or `unknown_error` based on the caught error type.
3. THE ExportQueue SHALL store the `DlqEntry` in the in-memory DLQ store immediately after the job status is set to `failed`.
4. IF the `DlqEntry` cannot be stored due to an internal error, THEN THE ExportQueue SHALL log the storage failure and continue without throwing.
5. THE ExportQueue SHALL cap the DLQ store at a configurable `maxDlqSize` (default 100); WHEN the cap is reached, THE ExportQueue SHALL evict the oldest entry before inserting the new one.

---

### Requirement 2: PII Sanitisation in DLQ Records

**User Story:** As a privacy-conscious operator, I want DLQ records to contain no personally identifiable information, so that the DLQ can be safely logged or exported to observability tooling.

#### Acceptance Criteria

1. THE ExportQueue SHALL replace `userId` and `targetUserId` fields with a deterministic, one-way opaque token (e.g. first 8 characters of SHA-256 hash) before writing to the `DlqEntry`.
2. THE ExportQueue SHALL NOT store raw Stellar account addresses, email addresses, or any field listed in `PRIVACY.md` inside a `DlqEntry`.
3. WHEN a `DlqEntry` is emitted to the MetricsHook, THE ExportQueue SHALL emit only the sanitised form.

---

### Requirement 3: DLQ Query Interface

**User Story:** As a backend engineer, I want to list and inspect DLQ entries programmatically, so that I can build admin tooling or automated alerting on top of the DLQ.

#### Acceptance Criteria

1. THE ExportQueue SHALL expose a `getDlqEntries()` method that returns a read-only snapshot of all current `DlqEntry` records, ordered newest-first.
2. THE ExportQueue SHALL expose a `getDlqEntry(jobId: string)` method that returns the `DlqEntry` for the given `jobId`, or `undefined` if not present.
3. THE ExportQueue SHALL expose a `getDlqDepth()` method that returns the current count of entries as a non-negative integer.
4. WHEN `getDlqEntries()` is called, THE ExportQueue SHALL return a new array so that mutations to the returned array do not affect the internal store.

---

### Requirement 4: DLQ Drain Operations

**User Story:** As a backend engineer, I want to re-queue or discard DLQ entries, so that I can remediate transient failures without restarting the service.

#### Acceptance Criteria

1. THE ExportQueue SHALL expose a `requeueDlqEntry(jobId: string)` method that removes the entry from the DLQ and re-creates the corresponding `ExportJob` with `status: 'pending'` and a reset attempt counter.
2. WHEN `requeueDlqEntry` is called with a `jobId` that does not exist in the DLQ, THE ExportQueue SHALL return `false` without throwing.
3. WHEN `requeueDlqEntry` is called with a valid `jobId`, THE ExportQueue SHALL return `true` and the re-queued job SHALL be processable by `processJob`.
4. THE ExportQueue SHALL expose a `discardDlqEntry(jobId: string)` method that permanently removes the entry from the DLQ and returns `true`; WHEN the `jobId` is not found, THE ExportQueue SHALL return `false`.
5. THE ExportQueue SHALL expose a `clearDlq()` method that removes all entries from the DLQ and returns the count of removed entries.

---

### Requirement 5: Optional Metrics Hook

**User Story:** As an operator, I want an optional metrics callback I can wire to my observability stack, so that I can track DLQ depth and failure rates without coupling the export service to a specific metrics library.

#### Acceptance Criteria

1. WHERE a MetricsHook is provided at ExportQueue construction, THE ExportQueue SHALL invoke the hook with a `DlqMetricsEvent` on each of: entry added, entry requeued, entry discarded, DLQ cleared.
2. THE ExportQueue SHALL define `DlqMetricsEvent` with fields: `event` (string literal union), `jobId`, `failureReason` (optional), `dlqDepth` (current depth after the mutation), `timestamp` (ISO-8601 UTC).
3. IF the MetricsHook throws, THEN THE ExportQueue SHALL catch the error, log a warning, and continue normal operation.
4. WHERE no MetricsHook is provided, THE ExportQueue SHALL operate identically without emitting any metrics events.

---

### Requirement 6: Observability Logging

**User Story:** As an operator, I want structured log lines emitted on DLQ mutations, so that I can correlate failures in log aggregation tools without needing the metrics hook.

#### Acceptance Criteria

1. WHEN a job is moved to the DLQ, THE ExportQueue SHALL emit a structured log line at `warn` level containing: `jobId`, `failureReason`, `errorMessage`, `attemptCount`, and `dlqDepth` — and SHALL NOT include raw `userId` or `targetUserId`.
2. WHEN a DLQ entry is requeued, THE ExportQueue SHALL emit a log line at `info` level containing `jobId` and `dlqDepth`.
3. WHEN a DLQ entry is discarded or the DLQ is cleared, THE ExportQueue SHALL emit a log line at `info` level containing `jobId` (or count for clear) and `dlqDepth`.

---

### Requirement 7: Test Coverage

**User Story:** As a developer, I want comprehensive Jest tests for the DLQ feature, so that regressions are caught automatically and coverage stays at or above 95% on changed code.

#### Acceptance Criteria

1. THE test suite SHALL cover: job-to-DLQ transition on failure, PII sanitisation correctness, DLQ cap eviction, `getDlqEntries` / `getDlqEntry` / `getDlqDepth` return values, `requeueDlqEntry` happy path and not-found path, `discardDlqEntry` happy path and not-found path, `clearDlq` return value, MetricsHook invocation on each mutation event, MetricsHook error isolation, and logging output.
2. THE Pretty_Printer (serialise → deserialise) SHALL be tested: FOR ALL valid `DlqEntry` objects, `JSON.parse(JSON.stringify(entry))` SHALL produce an equivalent object (round-trip property).
3. THE test suite SHALL run via `npm test` without additional configuration.
4. WHEN the MetricsHook is not provided, THE test suite SHALL verify that no hook-related errors are thrown during normal DLQ operations.
