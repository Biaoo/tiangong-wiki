import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeCodexWorkflowRunner } from "../../src/core/codex-workflow.js";
import { retryDashboardQueueItem } from "../../src/operations/dashboard.js";
import { createPageFromTemplate } from "../../src/core/page-files.js";
import { loadRuntimeConfig } from "../../src/core/runtime.js";
import { syncWorkspace } from "../../src/core/sync.js";
import { processVaultQueueBatch } from "../../src/core/vault-processing.js";
import {
  cleanupWorkspace,
  createWorkspace,
  queryDb,
  readPageMatter,
  runCli,
  runCliJson,
  waitFor,
  workspaceDbPath,
  writeVaultFile,
} from "../helpers.js";

function makeSummaryBody(fileId: string, extractedText: string): string {
  return [
    "## 来源信息",
    "",
    `这份来源文件是 \`${fileId}\`。`,
    "",
    "## 核心内容",
    "",
    extractedText,
    "",
    "## 关键结论",
    "",
    `- Durable takeaway from ${fileId}`,
    "",
    "## 与已有知识的关系",
    "",
    "这份来源可以作为后续知识页的证据。",
    "",
    "## 重要引用",
    "",
    extractedText,
  ].join("\n");
}

async function createSummaryFromVaultFile(
  env: NodeJS.ProcessEnv,
  title: string,
  fileId: string,
  sourceType: string | null,
  extractedText: string,
): Promise<string> {
  const runtime = loadRuntimeConfig(env);
  const created = createPageFromTemplate(runtime.paths, runtime.config, {
    pageType: "source-summary",
    title,
    frontmatterPatch: {
      status: "active",
      visibility: "shared",
      sourceType: sourceType ?? "file",
      vaultPath: fileId,
      keyFindings: [`Durable takeaway from ${fileId}`],
      sourceRefs: [`vault/${fileId}`],
      relatedPages: [],
      tags: ["imported-source"],
    },
    bodyMarkdown: makeSummaryBody(fileId, extractedText),
  });
  await syncWorkspace({ targetPaths: [created.pageId], env });
  return created.pageId;
}

function baseEnv(extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    WIKI_AGENT_ENABLED: "true",
    WIKI_AGENT_API_KEY: "test-agent-key",
    WIKI_AGENT_MODEL: "gpt-5.4",
    WIKI_AGENT_BATCH_SIZE: "10",
    ...extraEnv,
  };
}

const QUEUE_FULL_BACKOFF_MS = 300_000;

describe("acceptance: queue infrastructure", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  it("fills the queue on init and processes supported files through workflow-selected pages", async () => {
    const workspace = createWorkspace(baseEnv());
    workspaces.push(workspace);

    writeVaultFile(workspace, "imports/paper.pdf", "Bayes theorem improves decision quality with evidence.");
    writeVaultFile(workspace, "imports/brief.docx", "Product brief with three decision principles.");
    writeVaultFile(workspace, "imports/slides.pptx", "Slide deck about probabilistic reasoning.");
    writeVaultFile(workspace, "imports/metrics.xlsx", "Quarterly metrics and key variances.");
    writeVaultFile(workspace, "imports/notes.md", "# Notes\n\nBridge probability to product decisions.");
    writeVaultFile(workspace, "imports/diagram.png", "binary image placeholder");

    const initResult = runCliJson<{ initialized: boolean; backgroundQueueProcessingStarted: boolean }>(
      ["init"],
      workspace.env,
    );
    expect(initResult.initialized).toBe(true);
    expect(initResult.backgroundQueueProcessingStarted).toBe(false);

    const initialQueue = runCliJson<{
      totalPending: number;
      items: Array<{ fileId: string; status: string }>;
    }>(["vault", "queue"], workspace.env);
    expect(initialQueue.totalPending).toBe(5);
    expect(initialQueue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/paper.pdf", status: "pending" }),
        expect.objectContaining({ fileId: "imports/notes.md", status: "pending" }),
      ]),
    );
    expect(initialQueue.items.map((item) => item.fileId)).not.toContain("imports/diagram.png");

    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      if (queueItemId.endsWith(".png")) {
        return {
          status: "skipped",
          decision: "skip",
          reason: "Image-only file is not worth ingesting without dedicated OCR skills.",
          threadId,
          skillsUsed: ["tiangong-wiki-skill"],
          createdPageIds: [],
          updatedPageIds: [],
          appliedTypeNames: [],
          proposedTypes: [],
          actions: [],
          lint: [],
        };
      }

      const rawTitle = queueItemId.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "source";
      const pageId = await createSummaryFromVaultFile(
        workspace.env,
        rawTitle.replace(/[-_]+/g, " "),
        queueItemId,
        queueItemId.split(".").pop() ?? null,
        `Imported durable content from ${queueItemId}.`,
      );

      return {
        status: "done",
        decision: "apply",
        reason: "Captured the durable source as a reusable page.",
        threadId,
        skillsUsed: ["tiangong-wiki-skill"],
        createdPageIds: [pageId],
        updatedPageIds: [],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "create_page",
            pageType: "source-summary",
            pageId,
            title: rawTitle.replace(/[-_]+/g, " "),
            summary: "Created a reusable source page from the vault file.",
          },
        ],
        lint: [{ pageId, errors: 0, warnings: 0 }],
      };
    });

    const processed = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(processed.done).toBe(5);
    expect(processed.skipped).toBe(0);
    expect(processed.errored).toBe(0);

    const queue = runCliJson<{
      totalPending: number;
      totalDone: number;
      totalSkipped: number;
      items: Array<{ fileId: string; status: string; decision: string | null; threadId: string | null }>;
    }>(["vault", "queue"], workspace.env);
    expect(queue.totalPending).toBe(0);
    expect(queue.totalDone).toBe(5);
    expect(queue.totalSkipped).toBe(0);
    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/paper.pdf", status: "done", decision: "apply" }),
        expect.objectContaining({ fileId: "imports/notes.md", status: "done", decision: "apply" }),
      ]),
    );
    expect(queue.items.filter((item) => item.status === "done").every((item) => Boolean(item.threadId))).toBe(true);

    const sourceSummaries = runCliJson<Array<{ id: string; pageType: string }>>(
      ["find", "--type", "source-summary"],
      workspace.env,
    );
    expect(sourceSummaries).toHaveLength(5);

    const pageInfo = runCliJson<Record<string, unknown>>(["page-info", sourceSummaries[0].id], workspace.env);
    expect(pageInfo.sourceType).toBeTruthy();
    expect(pageInfo.vaultPath).toBeTruthy();

    const lint = runCliJson<{ errors: Array<unknown> }>(["lint", "--format", "json"], workspace.env);
    expect(lint.errors).toHaveLength(0);
  });

  it("retries queue errors and honors batch size limits", async () => {
    const workspace = createWorkspace(baseEnv({ WIKI_AGENT_BATCH_SIZE: "1" }));
    workspaces.push(workspace);

    const initResult = runCliJson<{ initialized: boolean; backgroundQueueProcessingStarted: boolean }>(
      ["init"],
      workspace.env,
    );
    expect(initResult.initialized).toBe(true);
    expect(initResult.backgroundQueueProcessingStarted).toBe(false);

    writeVaultFile(workspace, "imports/retry.pdf", "Retry me on the first queue cycle.");
    writeVaultFile(workspace, "imports/stable.txt", "Stable file should remain pending until its turn.");

    const syncResult = runCliJson<{ vault: { changes: number } }>(["sync"], workspace.env);
    expect(syncResult.vault.changes).toBe(2);

    const callCounts = new Map<string, number>();
    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      const calls = (callCounts.get(queueItemId) ?? 0) + 1;
      callCounts.set(queueItemId, calls);
      if (queueItemId.endsWith("retry.pdf") && calls === 1) {
        throw new Error("simulated first attempt failure");
      }

      const pageId = await createSummaryFromVaultFile(
        workspace.env,
        queueItemId.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "source",
        queueItemId,
        queueItemId.split(".").pop() ?? null,
        `Processed queue item ${queueItemId}.`,
      );

      return {
        status: "done",
        decision: "apply",
        reason: "Queue item processed successfully.",
        threadId,
        skillsUsed: ["tiangong-wiki-skill"],
        createdPageIds: [pageId],
        updatedPageIds: [],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "create_page",
            pageType: "source-summary",
            pageId,
            title: queueItemId,
            summary: "Created a source page from the queue item.",
          },
        ],
        lint: [{ pageId, errors: 0, warnings: 0 }],
      };
    });

    await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    const afterFirstRun = runCliJson<{
      totalDone: number;
      totalPending: number;
      totalError: number;
      items: Array<{ fileId: string; status: string; attempts: number }>;
    }>(["vault", "queue"], workspace.env);
    expect(afterFirstRun.totalError).toBe(1);
    expect(afterFirstRun.totalDone).toBe(1);
    expect(afterFirstRun.totalPending).toBe(0);
    expect(afterFirstRun.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/retry.pdf", status: "error", attempts: 1 }),
        expect.objectContaining({ fileId: "imports/stable.txt", status: "done" }),
      ]),
    );

    await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    const afterSecondRun = runCliJson<{ totalDone: number; totalPending: number; totalError: number }>(
      ["vault", "queue"],
      workspace.env,
    );
    expect(afterSecondRun.totalDone).toBe(2);
    expect(afterSecondRun.totalPending).toBe(0);
    expect(afterSecondRun.totalError).toBe(0);
  });

  it("keeps worker slots full by claiming the next queue item as soon as one finishes", async () => {
    const workspace = createWorkspace(baseEnv({ WIKI_AGENT_BATCH_SIZE: "2" }));
    workspaces.push(workspace);

    runCli(["init"], workspace.env);
    writeVaultFile(workspace, "imports/slot-slow.pdf", "Slow queue item.");
    writeVaultFile(workspace, "imports/slot-fast.txt", "Fast queue item.");
    writeVaultFile(workspace, "imports/slot-next.md", "# Next queue item");
    runCli(["sync"], workspace.env);

    const db = new Database(workspaceDbPath(workspace));
    try {
      db.prepare(
        `
          UPDATE vault_processing_queue
          SET priority = CASE file_id
            WHEN 'imports/slot-slow.pdf' THEN 30
            WHEN 'imports/slot-fast.txt' THEN 20
            WHEN 'imports/slot-next.md' THEN 10
            ELSE priority
          END
        `,
      ).run();
    } finally {
      db.close();
    }

    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    const startedItems: string[] = [];
    let releaseSlowWorker: (() => void) | null = null;
    const slowWorkerGate = new Promise<void>((resolve) => {
      releaseSlowWorker = resolve;
    });

    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      activeWorkers += 1;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      startedItems.push(queueItemId);

      try {
        if (queueItemId === "imports/slot-slow.pdf") {
          await slowWorkerGate;
        }

        return {
          status: "skipped",
          decision: "skip",
          reason: `Skipped ${queueItemId}.`,
          threadId,
          skillsUsed: ["tiangong-wiki-skill"],
          createdPageIds: [],
          updatedPageIds: [],
          appliedTypeNames: [],
          proposedTypes: [],
          actions: [],
          lint: [],
        };
      } finally {
        activeWorkers -= 1;
      }
    });

    const batchPromise = processVaultQueueBatch(workspace.env, { workflowRunner: runner });

    await waitFor(
      () =>
        startedItems.includes("imports/slot-slow.pdf") &&
        startedItems.includes("imports/slot-fast.txt"),
      5_000,
      20,
    );
    await waitFor(() => startedItems.includes("imports/slot-next.md"), 5_000, 20);

    expect(maxActiveWorkers).toBe(2);
    expect(startedItems.indexOf("imports/slot-next.md")).toBeGreaterThan(startedItems.indexOf("imports/slot-fast.txt"));

    releaseSlowWorker?.();

    const result = await batchPromise;
    expect(result).toMatchObject({
      processed: 3,
      done: 0,
      skipped: 3,
      errored: 0,
    });
  });

  it("stops auto-retrying queue errors after three retries", async () => {
    const workspace = createWorkspace(baseEnv({ WIKI_AGENT_BATCH_SIZE: "1" }));
    workspaces.push(workspace);

    const initResult = runCliJson<{ initialized: boolean; backgroundQueueProcessingStarted: boolean }>(
      ["init"],
      workspace.env,
    );
    expect(initResult.initialized).toBe(true);
    expect(initResult.backgroundQueueProcessingStarted).toBe(false);

    writeVaultFile(workspace, "imports/failing.pdf", "Keep failing until the auto-retry cap is exhausted.");
    writeVaultFile(workspace, "imports/stable.txt", "Stable file should proceed after the failing item is capped.");

    const syncResult = runCliJson<{ vault: { changes: number } }>(["sync"], workspace.env);
    expect(syncResult.vault.changes).toBe(2);

    const callCounts = new Map<string, number>();
    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      const calls = (callCounts.get(queueItemId) ?? 0) + 1;
      callCounts.set(queueItemId, calls);

      if (queueItemId.endsWith("failing.pdf")) {
        throw new Error(`persistent queue failure ${calls}`);
      }

      const pageId = await createSummaryFromVaultFile(
        workspace.env,
        queueItemId.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "source",
        queueItemId,
        queueItemId.split(".").pop() ?? null,
        `Processed queue item ${queueItemId}.`,
      );

      return {
        status: "done",
        decision: "apply",
        reason: "Queue item processed successfully.",
        threadId,
        skillsUsed: ["tiangong-wiki-skill"],
        createdPageIds: [pageId],
        updatedPageIds: [],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "create_page",
            pageType: "source-summary",
            pageId,
            title: queueItemId,
            summary: "Created a source page from the queue item.",
          },
        ],
        lint: [{ pageId, errors: 0, warnings: 0 }],
      };
    });

    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const processed = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
      const expectedProcessed = cycle === 1 ? 2 : 1;
      const expectedDone = cycle === 1 ? 1 : 0;
      expect(processed).toMatchObject({
        processed: expectedProcessed,
        errored: 1,
        done: expectedDone,
      });

      const queueRows = queryDb<Record<string, string | number | null>>(
        workspace,
        `
          SELECT
            file_id AS fileId,
            status,
            attempts,
            error_message AS errorMessage
          FROM vault_processing_queue
          WHERE file_id = 'imports/failing.pdf'
        `,
      );
      expect(queueRows).toEqual([
        expect.objectContaining({
          fileId: "imports/failing.pdf",
          status: "error",
          attempts: cycle,
        }),
      ]);
      if (cycle < 4) {
        expect(queueRows[0]?.errorMessage).toBe(`persistent queue failure ${cycle}`);
      } else {
        expect(queueRows[0]?.errorMessage).toContain("persistent queue failure 4");
        expect(queueRows[0]?.errorMessage).toContain("Auto retry limit reached after 3 retries");
      }
    }

    const cappedQueue = runCliJson<{
      totalDone: number;
      totalPending: number;
      totalError: number;
      items: Array<{ fileId: string; status: string; attempts: number }>;
    }>(["vault", "queue"], workspace.env);
    expect(cappedQueue.totalDone).toBe(1);
    expect(cappedQueue.totalPending).toBe(0);
    expect(cappedQueue.totalError).toBe(1);
    expect(cappedQueue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/failing.pdf", status: "error", attempts: 4 }),
        expect.objectContaining({ fileId: "imports/stable.txt", status: "done", attempts: 0 }),
      ]),
    );

    const afterCap = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(afterCap).toMatchObject({
      processed: 0,
      done: 0,
      errored: 0,
    });
    expect(callCounts.get("imports/failing.pdf")).toBe(4);

    const finalQueue = runCliJson<{ totalDone: number; totalPending: number; totalError: number }>(
      ["vault", "queue"],
      workspace.env,
    );
    expect(finalQueue.totalDone).toBe(1);
    expect(finalQueue.totalPending).toBe(0);
    expect(finalQueue.totalError).toBe(1);
  });

  it("backs off queue_full workflow errors, records structured error state, and retries after retry_after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T09:00:00Z"));

    const workspace = createWorkspace(baseEnv({ WIKI_AGENT_BATCH_SIZE: "1" }));
    workspaces.push(workspace);

    runCli(["init"], workspace.env);
    writeVaultFile(workspace, "imports/blocked.pdf", "Queue-full item.");
    writeVaultFile(workspace, "imports/stable.txt", "Stable item should proceed while blocked item backs off.");
    runCli(["sync"], workspace.env);

    const callCounts = new Map<string, number>();
    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      const calls = (callCounts.get(queueItemId) ?? 0) + 1;
      callCounts.set(queueItemId, calls);

      if (queueItemId.endsWith("blocked.pdf") && calls === 1) {
        return {
          status: "error",
          decision: "apply",
          reason: "tiangong-wiki sync failed with queue_full (Write queue is full).",
          threadId,
          skillsUsed: ["pdf", "tiangong-wiki-skill"],
          createdPageIds: ["achievements/blocked-award.md"],
          updatedPageIds: [],
          appliedTypeNames: ["achievement"],
          proposedTypes: [],
          actions: [
            {
              kind: "create_page",
              pageType: "achievement",
              pageId: "achievements/blocked-award.md",
              title: "Blocked Award",
              summary: "Queue-full failure manifest for backoff testing.",
            },
          ],
          lint: [{ pageId: "achievements/blocked-award.md", errors: 0, warnings: 1 }],
        };
      }

      const pageId = await createSummaryFromVaultFile(
        workspace.env,
        queueItemId.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "source",
        queueItemId,
        queueItemId.split(".").pop() ?? null,
        `Processed queue item ${queueItemId}.`,
      );

      return {
        status: "done",
        decision: "apply",
        reason: "Queue item processed successfully.",
        threadId,
        skillsUsed: ["tiangong-wiki-skill"],
        createdPageIds: [pageId],
        updatedPageIds: [],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "create_page",
            pageType: "source-summary",
            pageId,
            title: queueItemId,
            summary: "Created a source page from the queue item.",
          },
        ],
        lint: [{ pageId, errors: 0, warnings: 0 }],
      };
    });

    const firstResult = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(firstResult).toMatchObject({
      processed: 2,
      done: 1,
      errored: 1,
      items: expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/blocked.pdf", status: "error", decision: "apply" }),
        expect.objectContaining({ fileId: "imports/stable.txt", status: "done" }),
      ]),
    });

    const afterFirstRun = runCliJson<{
      totalDone: number;
      totalError: number;
      items: Array<{
        fileId: string;
        status: string;
        attempts: number;
        lastErrorCode?: string | null;
        retryAfter?: string | null;
        autoRetryExhausted?: boolean;
      }>;
    }>(["vault", "queue"], workspace.env);
    expect(afterFirstRun.totalDone).toBe(1);
    expect(afterFirstRun.totalError).toBe(1);
    expect(afterFirstRun.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "imports/blocked.pdf",
          status: "error",
          attempts: 1,
          lastErrorCode: "queue_full",
          autoRetryExhausted: false,
        }),
      ]),
    );
    const blockedAfterFirstRun = afterFirstRun.items.find((item) => item.fileId === "imports/blocked.pdf");
    expect(blockedAfterFirstRun?.retryAfter).toBeTruthy();
    expect(Date.parse(String(blockedAfterFirstRun?.retryAfter))).toBeGreaterThan(Date.now());

    const secondResult = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(secondResult).toMatchObject({
      processed: 0,
      done: 0,
      errored: 0,
      items: [],
    });
    expect(callCounts.get("imports/blocked.pdf")).toBe(1);

    vi.advanceTimersByTime(QUEUE_FULL_BACKOFF_MS + 1_000);
    const thirdResult = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(thirdResult).toMatchObject({
      processed: 1,
      done: 1,
      errored: 0,
      items: [expect.objectContaining({ fileId: "imports/blocked.pdf", status: "done" })],
    });
    expect(callCounts.get("imports/blocked.pdf")).toBe(2);

    const finalQueue = runCliJson<{ totalDone: number; totalError: number; totalPending: number }>(
      ["vault", "queue"],
      workspace.env,
    );
    expect(finalQueue).toMatchObject({
      totalDone: 2,
      totalError: 0,
      totalPending: 0,
    });
  });

  it("resets attempts and retry metadata on manual retry and on file change requeue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T09:00:00Z"));

    const workspace = createWorkspace(baseEnv({ WIKI_AGENT_BATCH_SIZE: "1" }));
    workspaces.push(workspace);

    runCli(["init"], workspace.env);
    writeVaultFile(workspace, "imports/reset.pdf", "First version.");
    runCli(["sync"], workspace.env);

    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      if (queueItemId.endsWith("reset.pdf")) {
        return {
          status: "error",
          decision: "apply",
          reason: "tiangong-wiki sync failed with queue_full (Write queue is full).",
          threadId,
          skillsUsed: ["pdf", "tiangong-wiki-skill"],
          createdPageIds: ["achievements/reset-award.md"],
          updatedPageIds: [],
          appliedTypeNames: ["achievement"],
          proposedTypes: [],
          actions: [
            {
              kind: "create_page",
              pageType: "achievement",
              pageId: "achievements/reset-award.md",
              title: "Reset Award",
              summary: "Queue-full failure manifest for reset testing.",
            },
          ],
          lint: [{ pageId: "achievements/reset-award.md", errors: 0, warnings: 1 }],
        };
      }

      throw new Error(`unexpected queue item: ${queueItemId}`);
    });

    await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    let queueRows = queryDb<Record<string, string | number | null>>(
      workspace,
      `
        SELECT
          status,
          attempts,
          error_message AS errorMessage,
          last_error_code AS lastErrorCode,
          retry_after AS retryAfter
        FROM vault_processing_queue
        WHERE file_id = 'imports/reset.pdf'
      `,
    );
    expect(queueRows).toEqual([
      expect.objectContaining({
        status: "error",
        attempts: 1,
        lastErrorCode: "queue_full",
      }),
    ]);
    expect(queueRows[0]?.retryAfter).toBeTruthy();

    retryDashboardQueueItem(workspace.env, "imports/reset.pdf");
    queueRows = queryDb<Record<string, string | number | null>>(
      workspace,
      `
        SELECT
          status,
          attempts,
          error_message AS errorMessage,
          last_error_code AS lastErrorCode,
          retry_after AS retryAfter
        FROM vault_processing_queue
        WHERE file_id = 'imports/reset.pdf'
      `,
    );
    expect(queueRows).toEqual([
      {
        status: "pending",
        attempts: 0,
        errorMessage: null,
        lastErrorCode: null,
        retryAfter: null,
      },
    ]);

    await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    writeVaultFile(workspace, "imports/reset.pdf", "Second version with updated source content.");
    runCli(["sync"], workspace.env);
    queueRows = queryDb<Record<string, string | number | null>>(
      workspace,
      `
        SELECT
          status,
          attempts,
          error_message AS errorMessage,
          last_error_code AS lastErrorCode,
          retry_after AS retryAfter
        FROM vault_processing_queue
        WHERE file_id = 'imports/reset.pdf'
      `,
    );
    expect(queueRows).toEqual([
      {
        status: "pending",
        attempts: 0,
        errorMessage: null,
        lastErrorCode: null,
        retryAfter: null,
      },
    ]);
  });

  it("allows the workflow to choose non-source-summary page types for vault files", async () => {
    const workspace = createWorkspace(baseEnv());
    workspaces.push(workspace);

    writeVaultFile(workspace, "imports/paper.pdf", "Short but durable paper about evidence-linked summaries.");
    writeVaultFile(workspace, "imports/team-deck-a.pptx", "Slide deck A outlines a reusable wiki ingestion workflow.");

    const initResult = runCliJson<{ initialized: boolean; backgroundQueueProcessingStarted: boolean }>(
      ["init"],
      workspace.env,
    );
    expect(initResult.initialized).toBe(true);
    expect(initResult.backgroundQueueProcessingStarted).toBe(false);

    const runner = new FakeCodexWorkflowRunner(async ({ queueItemId, threadId }) => {
      const runtime = loadRuntimeConfig(workspace.env);
      if (queueItemId.endsWith("team-deck-a.pptx")) {
        const created = createPageFromTemplate(runtime.paths, runtime.config, {
          pageType: "method",
          title: "Team Deck A: Wiki Ingestion Workflow",
          frontmatterPatch: {
            status: "active",
            visibility: "shared",
            domain: "research",
            effectiveness: "medium",
            sourceRefs: [`vault/${queueItemId}`],
            relatedPages: [],
            tags: ["slides", "workflow"],
          },
          bodyMarkdown: [
            "## Summary",
            "",
            "A reusable workflow for importing evidence into the wiki.",
            "",
            "## Steps",
            "",
            "- Review the source.",
            "- Route it into the current ontology.",
          ].join("\n"),
        });
        await syncWorkspace({ targetPaths: [created.pageId], env: workspace.env });
        return {
          status: "done",
          decision: "apply",
          reason: "The slide deck describes a repeatable workflow, so method is the better fit.",
          threadId,
          skillsUsed: ["tiangong-wiki-skill", "slides"],
          createdPageIds: [created.pageId],
          updatedPageIds: [],
          appliedTypeNames: ["method"],
          proposedTypes: [],
          actions: [
            {
              kind: "create_page",
              pageType: "method",
              pageId: created.pageId,
              title: "Team Deck A: Wiki Ingestion Workflow",
              summary: "Created a method page from the deck.",
            },
          ],
          lint: [{ pageId: created.pageId, errors: 0, warnings: 0 }],
        };
      }

      const pageId = await createSummaryFromVaultFile(
        workspace.env,
        "paper",
        queueItemId,
        "pdf",
        "Short but durable paper about evidence-linked summaries.",
      );
      return {
        status: "done",
        decision: "apply",
        reason: "The paper is best preserved as a source-centric page.",
        threadId,
        skillsUsed: ["tiangong-wiki-skill", "pdf"],
        createdPageIds: [pageId],
        updatedPageIds: [],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "create_page",
            pageType: "source-summary",
            pageId,
            title: "paper",
            summary: "Created a source-summary page from the paper.",
          },
        ],
        lint: [{ pageId, errors: 0, warnings: 0 }],
      };
    });

    const processed = await processVaultQueueBatch(workspace.env, { workflowRunner: runner });
    expect(processed.done).toBe(2);
    expect(processed.skipped).toBe(0);
    expect(processed.errored).toBe(0);

    const methods = runCliJson<Array<{ id: string }>>(["find", "--type", "method"], workspace.env);
    expect(methods).toHaveLength(1);
    const sourceSummaries = runCliJson<Array<{ id: string }>>(["find", "--type", "source-summary"], workspace.env);
    expect(sourceSummaries).toHaveLength(1);

    const queue = runCliJson<{
      items: Array<{ fileId: string; appliedTypeNames: string[]; resultPageId: string | null }>;
    }>(["vault", "queue"], workspace.env);
    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "imports/paper.pdf", appliedTypeNames: ["source-summary"] }),
        expect.objectContaining({ fileId: "imports/team-deck-a.pptx", appliedTypeNames: ["method"] }),
      ]),
    );

    const method = readPageMatter(workspace, methods[0].id);
    expect(method.content).toContain("Route it into the current ontology.");
  });
});
