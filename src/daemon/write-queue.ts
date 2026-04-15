import { randomUUID } from "node:crypto";

import { openRuntimeDb } from "../core/runtime.js";
import type { DaemonTask, DaemonWriteJobSnapshot, DaemonWriteJobStatus, DaemonWriteQueueSummary } from "../types/page.js";
import { AppError, asAppError } from "../utils/errors.js";
import { toOffsetIso } from "../utils/time.js";

const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_JOB_TIMEOUT_MS = 300_000;
const RECENT_JOB_LIMIT = 12;
const QUEUED_JOB_PREVIEW_LIMIT = 20;

type JobHooks = {
  onJobStart?: (job: DaemonWriteJobSnapshot) => void;
  onJobFinish?: (job: DaemonWriteJobSnapshot) => void;
};

type QueueJobOptions<T> = {
  summarizeResult?: (result: T) => Record<string, unknown> | null;
};

type InternalJob = {
  snapshot: DaemonWriteJobSnapshot;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: AppError) => void;
  summarizeResult?: (result: unknown) => Record<string, unknown> | null;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function serializeOptionalObject(value: Record<string, unknown> | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function snapshotDurationMs(job: Pick<DaemonWriteJobSnapshot, "startedAt" | "finishedAt">): number | null {
  if (!job.startedAt || !job.finishedAt) {
    return null;
  }
  const startedAtMs = new Date(job.startedAt).getTime();
  const finishedAtMs = new Date(job.finishedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return null;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}

function cloneSnapshot(
  snapshot: DaemonWriteJobSnapshot,
  positionInQueue: number | null = snapshot.positionInQueue,
): DaemonWriteJobSnapshot {
  return {
    ...snapshot,
    positionInQueue,
    resultSummary: snapshot.resultSummary ? { ...snapshot.resultSummary } : null,
    errorDetails: snapshot.errorDetails ? { ...snapshot.errorDetails } : null,
  };
}

function createInitialSnapshot(
  taskType: DaemonTask,
  timeoutMs: number,
  queueDepthAtEnqueue: number,
): DaemonWriteJobSnapshot {
  return {
    jobId: randomUUID(),
    taskType,
    status: "queued",
    enqueuedAt: toOffsetIso(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    timeoutMs,
    queueDepthAtEnqueue,
    positionInQueue: queueDepthAtEnqueue + 1,
    resultSummary: null,
    errorMessage: null,
    errorDetails: null,
  };
}

function readPersistedRecentJobs(
  env: NodeJS.ProcessEnv,
  limit = RECENT_JOB_LIMIT,
): DaemonWriteJobSnapshot[] {
  const { db } = openRuntimeDb(env);
  try {
    const rows = db.prepare(
      `
        SELECT
          job_id AS jobId,
          task_type AS taskType,
          status,
          enqueued_at AS enqueuedAt,
          started_at AS startedAt,
          finished_at AS finishedAt,
          duration_ms AS durationMs,
          timeout_ms AS timeoutMs,
          queue_depth_at_enqueue AS queueDepthAtEnqueue,
          result_summary AS resultSummary,
          error_message AS errorMessage,
          error_details AS errorDetails
        FROM daemon_write_jobs
        WHERE status IN ('succeeded', 'failed', 'timed_out')
        ORDER BY COALESCE(finished_at, enqueued_at) DESC
        LIMIT ?
      `,
    ).all(limit) as Array<{
      jobId: string;
      taskType: DaemonTask;
      status: DaemonWriteJobStatus;
      enqueuedAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
      timeoutMs: number;
      queueDepthAtEnqueue: number;
      resultSummary: string | null;
      errorMessage: string | null;
      errorDetails: string | null;
    }>;
    return rows.map((row) => ({
      jobId: row.jobId,
      taskType: row.taskType,
      status: row.status,
      enqueuedAt: row.enqueuedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      timeoutMs: row.timeoutMs,
      queueDepthAtEnqueue: row.queueDepthAtEnqueue,
      positionInQueue: null,
      resultSummary: parseOptionalObject(row.resultSummary),
      errorMessage: row.errorMessage,
      errorDetails: parseOptionalObject(row.errorDetails),
    }));
  } finally {
    db.close();
  }
}

function readPersistedJob(
  env: NodeJS.ProcessEnv,
  jobId: string,
): DaemonWriteJobSnapshot | null {
  const { db } = openRuntimeDb(env);
  try {
    const row = db.prepare(
      `
        SELECT
          job_id AS jobId,
          task_type AS taskType,
          status,
          enqueued_at AS enqueuedAt,
          started_at AS startedAt,
          finished_at AS finishedAt,
          duration_ms AS durationMs,
          timeout_ms AS timeoutMs,
          queue_depth_at_enqueue AS queueDepthAtEnqueue,
          result_summary AS resultSummary,
          error_message AS errorMessage,
          error_details AS errorDetails
        FROM daemon_write_jobs
        WHERE job_id = ?
      `,
    ).get(jobId) as
      | {
          jobId: string;
          taskType: DaemonTask;
          status: DaemonWriteJobStatus;
          enqueuedAt: string;
          startedAt: string | null;
          finishedAt: string | null;
          durationMs: number | null;
          timeoutMs: number;
          queueDepthAtEnqueue: number;
          resultSummary: string | null;
          errorMessage: string | null;
          errorDetails: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      jobId: row.jobId,
      taskType: row.taskType,
      status: row.status,
      enqueuedAt: row.enqueuedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      timeoutMs: row.timeoutMs,
      queueDepthAtEnqueue: row.queueDepthAtEnqueue,
      positionInQueue: null,
      resultSummary: parseOptionalObject(row.resultSummary),
      errorMessage: row.errorMessage,
      errorDetails: parseOptionalObject(row.errorDetails),
    };
  } finally {
    db.close();
  }
}

function persistJobSnapshot(env: NodeJS.ProcessEnv, snapshot: DaemonWriteJobSnapshot): void {
  const { db } = openRuntimeDb(env);
  try {
    db.prepare(
      `
        INSERT INTO daemon_write_jobs (
          job_id,
          task_type,
          status,
          enqueued_at,
          started_at,
          finished_at,
          duration_ms,
          timeout_ms,
          queue_depth_at_enqueue,
          result_summary,
          error_message,
          error_details
        )
        VALUES (
          @job_id,
          @task_type,
          @status,
          @enqueued_at,
          @started_at,
          @finished_at,
          @duration_ms,
          @timeout_ms,
          @queue_depth_at_enqueue,
          @result_summary,
          @error_message,
          @error_details
        )
        ON CONFLICT(job_id) DO UPDATE SET
          task_type = excluded.task_type,
          status = excluded.status,
          enqueued_at = excluded.enqueued_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          duration_ms = excluded.duration_ms,
          timeout_ms = excluded.timeout_ms,
          queue_depth_at_enqueue = excluded.queue_depth_at_enqueue,
          result_summary = excluded.result_summary,
          error_message = excluded.error_message,
          error_details = excluded.error_details
      `,
    ).run({
      job_id: snapshot.jobId,
      task_type: snapshot.taskType,
      status: snapshot.status,
      enqueued_at: snapshot.enqueuedAt,
      started_at: snapshot.startedAt,
      finished_at: snapshot.finishedAt,
      duration_ms: snapshot.durationMs,
      timeout_ms: snapshot.timeoutMs,
      queue_depth_at_enqueue: snapshot.queueDepthAtEnqueue,
      result_summary: serializeOptionalObject(snapshot.resultSummary),
      error_message: snapshot.errorMessage,
      error_details: serializeOptionalObject(snapshot.errorDetails),
    });
  } finally {
    db.close();
  }
}

export class DaemonWriteQueue {
  readonly maxDepth: number;
  readonly jobTimeoutMs: number;

  private readonly env: NodeJS.ProcessEnv;
  private readonly hooks: JobHooks;
  private readonly pendingJobs: InternalJob[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private activeJob: InternalJob | null = null;

  constructor(
    env: NodeJS.ProcessEnv,
    hooks: JobHooks = {},
  ) {
    this.env = env;
    this.hooks = hooks;
    this.maxDepth = parsePositiveInteger(env.WIKI_TEST_WRITE_QUEUE_MAX_DEPTH, DEFAULT_MAX_DEPTH);
    this.jobTimeoutMs = parsePositiveInteger(env.WIKI_TEST_WRITE_QUEUE_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS);
  }

  hasWork(): boolean {
    return this.activeJob !== null || this.pendingJobs.length > 0;
  }

  getSummary(): DaemonWriteQueueSummary {
    return {
      limits: {
        maxDepth: this.maxDepth,
        jobTimeoutMs: this.jobTimeoutMs,
      },
      counts: {
        queued: this.pendingJobs.length,
        running: this.activeJob ? 1 : 0,
        recent: readPersistedRecentJobs(this.env).length,
      },
      activeJob: this.activeJob ? cloneSnapshot(this.activeJob.snapshot, null) : null,
      queuedJobs: this.pendingJobs
        .slice(0, QUEUED_JOB_PREVIEW_LIMIT)
        .map((job, index) => cloneSnapshot(job.snapshot, index + 1)),
      recentJobs: readPersistedRecentJobs(this.env),
      generatedAt: toOffsetIso(),
    };
  }

  getJob(jobId: string): DaemonWriteJobSnapshot | null {
    if (this.activeJob?.snapshot.jobId === jobId) {
      return cloneSnapshot(this.activeJob.snapshot, null);
    }

    const pendingIndex = this.pendingJobs.findIndex((job) => job.snapshot.jobId === jobId);
    if (pendingIndex >= 0) {
      return cloneSnapshot(this.pendingJobs[pendingIndex]!.snapshot, pendingIndex + 1);
    }

    return readPersistedJob(this.env, jobId);
  }

  async waitForIdle(): Promise<void> {
    if (!this.hasWork()) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  enqueue<T>(
    taskType: DaemonTask,
    run: () => Promise<T>,
    options: QueueJobOptions<T> = {},
  ): Promise<T> {
    if (this.pendingJobs.length >= this.maxDepth) {
      throw new AppError("Write queue is full.", "runtime", {
        code: "queue_full",
        maxDepth: this.maxDepth,
      });
    }

    const snapshot = createInitialSnapshot(taskType, this.jobTimeoutMs, this.pendingJobs.length);
    persistJobSnapshot(this.env, snapshot);

    return new Promise<T>((resolve, reject) => {
      this.pendingJobs.push({
        snapshot,
        run: () => run(),
        resolve: (value) => resolve(value as T),
        reject,
        summarizeResult: options.summarizeResult
          ? (result) => options.summarizeResult!(result as T)
          : undefined,
      });
      void this.processNext();
    });
  }

  private notifyIdleIfNeeded(): void {
    if (this.hasWork()) {
      return;
    }
    while (this.idleResolvers.length > 0) {
      this.idleResolvers.pop()!();
    }
  }

  private async processNext(): Promise<void> {
    if (this.activeJob || this.pendingJobs.length === 0) {
      return;
    }

    const job = this.pendingJobs.shift()!;
    this.activeJob = job;
    job.snapshot.status = "running";
    job.snapshot.startedAt = toOffsetIso();
    job.snapshot.positionInQueue = null;
    persistJobSnapshot(this.env, job.snapshot);
    this.hooks.onJobStart?.(cloneSnapshot(job.snapshot, null));

    let timeoutHandle: NodeJS.Timeout | null = null;
    let didTimeout = false;
    const runPromise = Promise.resolve().then(job.run);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        reject(
          new AppError(`Write queue job timed out after ${job.snapshot.timeoutMs}ms.`, "runtime", {
            code: "job_timeout",
            jobId: job.snapshot.jobId,
            taskType: job.snapshot.taskType,
            timeoutMs: job.snapshot.timeoutMs,
          }),
        );
      }, job.snapshot.timeoutMs);
    });

    try {
      const result = await Promise.race([runPromise, timeoutPromise]);
      job.snapshot.status = "succeeded";
      job.snapshot.finishedAt = toOffsetIso();
      job.snapshot.durationMs = snapshotDurationMs(job.snapshot);
      job.snapshot.resultSummary = job.summarizeResult?.(result) ?? null;
      job.snapshot.errorMessage = null;
      job.snapshot.errorDetails = null;
      persistJobSnapshot(this.env, job.snapshot);
      job.resolve(result);
    } catch (error) {
      const appError = asAppError(error);
      job.snapshot.status = didTimeout ? "timed_out" : "failed";
      job.snapshot.finishedAt = toOffsetIso();
      job.snapshot.durationMs = snapshotDurationMs(job.snapshot);
      job.snapshot.errorMessage = appError.message;
      job.snapshot.errorDetails =
        typeof appError.details === "object" && appError.details !== null && !Array.isArray(appError.details)
          ? ({ ...appError.details } as Record<string, unknown>)
          : null;
      persistJobSnapshot(this.env, job.snapshot);
      job.reject(appError);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (didTimeout) {
        await runPromise.catch(() => undefined);
      }
      this.activeJob = null;
      this.hooks.onJobFinish?.(cloneSnapshot(job.snapshot, null));
      this.notifyIdleIfNeeded();
      void this.processNext();
    }
  }
}
