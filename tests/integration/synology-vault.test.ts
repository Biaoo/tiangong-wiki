import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeCodexWorkflowRunner } from "../../src/core/codex-workflow.js";
import { createPageFromTemplate, updatePageById } from "../../src/core/page-files.js";
import { loadRuntimeConfig } from "../../src/core/runtime.js";
import { syncWorkspace } from "../../src/core/sync.js";
import { processVaultQueueBatch } from "../../src/core/vault-processing.js";
import {
  cleanupWorkspace,
  createWorkspace,
  readFile,
  runCliJson,
  startSynologyServer,
  type SynologyTestState,
} from "../helpers.js";

describe("synology vault polling", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  function buildSynologyEnv(workspace: ReturnType<typeof createWorkspace>, baseUrl: string): NodeJS.ProcessEnv {
    return {
      ...workspace.env,
      SYNOLOGY_BASE_URL: baseUrl,
      SYNOLOGY_USERNAME: "tester",
      SYNOLOGY_PASSWORD: "secret",
    };
  }

  it("indexes vault files through the Synology polling branch when using mtime hashing", async () => {
    const workspace = createWorkspace({
      VAULT_SOURCE: "synology",
      VAULT_SYNOLOGY_REMOTE_PATH: "/vault",
      VAULT_HASH_MODE: "mtime",
    });
    workspaces.push(workspace);

    const server = await startSynologyServer(workspace.root, {
      files: {
        "/vault/projects/brief.pdf": {
          size: 12,
          mtime: 1_700_000_000,
          content: "brief pdf",
        },
        "/vault/imports/notes.txt": {
          size: 9,
          mtime: 1_700_000_001,
          content: "notes txt",
        },
        "/vault/imports/Thumbs.db": {
          size: 3,
          mtime: 1_700_000_002,
          content: "db!",
        },
      },
    });
    servers.push(server);

    const env = buildSynologyEnv(workspace, server.baseUrl);

    const init = runCliJson<{ initialized: boolean }>(["init"], env);
    expect(init.initialized).toBe(true);

    const vaultList = runCliJson<Array<{ id: string }>>(["vault", "list"], env);
    expect(vaultList.map((item) => item.id)).toEqual(
      expect.arrayContaining(["projects/brief.pdf", "imports/notes.txt"]),
    );
    expect(vaultList.map((item) => item.id)).not.toContain("imports/Thumbs.db");
  });

  it("paginates through large Synology directories", async () => {
    const workspace = createWorkspace({
      VAULT_SOURCE: "synology",
      VAULT_SYNOLOGY_REMOTE_PATH: "/vault",
      VAULT_HASH_MODE: "mtime",
    });
    workspaces.push(workspace);

    const files: SynologyTestState["files"] = {};
    for (let index = 0; index <= 1200; index += 1) {
      files[`/vault/imports/doc-${index.toString().padStart(4, "0")}.pdf`] = {
        size: index + 10,
        mtime: 1_700_000_000 + index,
        content: `doc-${index}`,
      };
    }

    const server = await startSynologyServer(workspace.root, { files });
    servers.push(server);

    const env = buildSynologyEnv(workspace, server.baseUrl);

    runCliJson(["init"], env);

    const vaultList = runCliJson<Array<{ id: string }>>(["vault", "list"], env);
    expect(vaultList).toHaveLength(1201);
    expect(vaultList[0]?.id).toBe("imports/doc-0000.pdf");
    expect(vaultList.at(-1)?.id).toBe("imports/doc-1200.pdf");
  });

  it("downloads and refreshes Synology cache files for content hashing and queue processing", async () => {
    const workspace = createWorkspace({
      VAULT_SOURCE: "synology",
      VAULT_SYNOLOGY_REMOTE_PATH: "/vault",
      VAULT_HASH_MODE: "content",
      WIKI_AGENT_ENABLED: "true",
      WIKI_AGENT_API_KEY: "test-agent-key",
      WIKI_AGENT_MODEL: "gpt-5.4",
      WIKI_AGENT_BATCH_SIZE: "0",
    });
    workspaces.push(workspace);

    const server = await startSynologyServer(workspace.root, {
      files: {
        "/vault/report.pdf": {
          size: 9,
          mtime: 1_700_000_000,
          content: "version-1",
        },
      },
    });
    servers.push(server);

    const env = buildSynologyEnv(workspace, server.baseUrl);

    runCliJson(["init"], env);

    const cachePath = path.join(workspace.vaultPath, "report.pdf");
    expect(readFile(cachePath)).toBe("version-1");
    expect(readFile(`${cachePath}.wiki-cache.json`)).toContain("\"fileMtime\": 1700000000");

    let createdPageId: string | null = null;
    const runner = new FakeCodexWorkflowRunner(async ({ threadId, input }) => {
      const runtime = loadRuntimeConfig(input.env);
      if (!createdPageId) {
        const created = createPageFromTemplate(runtime.paths, runtime.config, {
          pageType: "source-summary",
          title: "synology report",
          frontmatterPatch: {
            status: "active",
            visibility: "shared",
            sourceType: "pdf",
            vaultPath: "report.pdf",
            keyFindings: ["version-1"],
            sourceRefs: ["vault/report.pdf"],
            relatedPages: [],
            tags: ["synology"],
          },
          bodyMarkdown: [
            "## 来源信息",
            "",
            "Synology source imported.",
            "",
            "## 核心内容",
            "",
            "version-1",
            "",
            "## 关键结论",
            "",
            "- version-1",
            "",
            "## 与已有知识的关系",
            "",
            "Created from the initial cache download.",
            "",
            "## 重要引用",
            "",
            "version-1",
          ].join("\n"),
        });
        createdPageId = created.pageId;
        await syncWorkspace({ targetPaths: [createdPageId], env: input.env });
        return {
          status: "done",
          decision: "apply",
          reason: "new source file",
          threadId,
          skillsUsed: ["wiki-skill"],
          createdPageIds: [createdPageId],
          updatedPageIds: [],
          appliedTypeNames: ["source-summary"],
          proposedTypes: [],
          actions: [
            {
              kind: "create_page",
              pageType: "source-summary",
              pageId: createdPageId,
              title: "synology report",
              summary: "Created a source-summary page from the Synology cache.",
            },
          ],
          lint: [{ pageId: createdPageId, errors: 0, warnings: 0 }],
        };
      }

      updatePageById(runtime.paths, createdPageId, {
        frontmatterPatch: {
          sourceType: "pdf",
          vaultPath: "report.pdf",
          keyFindings: ["version-2-updated"],
          sourceRefs: ["vault/report.pdf"],
          relatedPages: [],
          tags: ["synology"],
        },
        bodyMarkdown: [
          "## 来源信息",
          "",
          "Synology cached file refreshed.",
          "",
          "## 核心内容",
          "",
          "version-2-updated",
          "",
          "## 关键结论",
          "",
          "- version-2-updated",
          "",
          "## 与已有知识的关系",
          "",
          "Updated from the same source page.",
          "",
          "## 重要引用",
          "",
          "version-2-updated",
        ].join("\n"),
      });
      await syncWorkspace({ targetPaths: [createdPageId], env: input.env });
      return {
        status: "done",
        decision: "apply",
        reason: "source changed",
        threadId,
        skillsUsed: ["wiki-skill"],
        createdPageIds: [],
        updatedPageIds: [createdPageId],
        appliedTypeNames: ["source-summary"],
        proposedTypes: [],
        actions: [
          {
            kind: "update_page",
            pageType: "source-summary",
            pageId: createdPageId,
            summary: "Updated the cached Synology source page.",
          },
        ],
        lint: [{ pageId: createdPageId, errors: 0, warnings: 0 }],
      };
    });

    await processVaultQueueBatch({ ...env, WIKI_AGENT_BATCH_SIZE: "1" }, { workflowRunner: runner });
    const createdPage = runCliJson<Array<{ id: string }>>(["find", "--type", "source-summary"], env);
    expect(createdPage).toHaveLength(1);
    expect(readFile(path.join(workspace.wikiPath, createdPage[0].id))).toContain("version-1");

    server.writeState({
      files: {
        "/vault/report.pdf": {
          size: 17,
          mtime: 1_700_000_500,
          content: "version-2-updated",
        },
      },
    });

    const syncResult = runCliJson<{ vault: { changes: number; queue: { pendingReset: number } } }>(["sync"], env);
    expect(syncResult.vault.changes).toBe(1);
    expect(syncResult.vault.queue.pendingReset).toBe(1);

    await processVaultQueueBatch({ ...env, WIKI_AGENT_BATCH_SIZE: "1" }, { workflowRunner: runner });

    expect(readFile(cachePath)).toBe("version-2-updated");
    const updatedPage = readFile(path.join(workspace.wikiPath, createdPage[0].id));
    expect(updatedPage).toContain("version-2-updated");
    expect(readFile(`${cachePath}.wiki-cache.json`)).toContain("\"fileMtime\": 1700000500");
  });
});
