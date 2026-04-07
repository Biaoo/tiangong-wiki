import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapRuntimeAssets,
  cleanupWorkspace,
  createWorkspace,
  queryDb,
  runCliJson,
  updateWikiConfig,
  writeVaultFile,
} from "../helpers.js";

describe("vault file type filtering", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  it("indexes only whitelisted file types by default", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    writeVaultFile(workspace, "imports/paper.pdf", "paper");
    writeVaultFile(workspace, "imports/notes.txt", "notes");
    writeVaultFile(workspace, "config/settings.yaml", "flag: true");
    writeVaultFile(workspace, ".DS_Store", "ignored");
    writeVaultFile(workspace, "imports/Thumbs.db", "ignored");
    writeVaultFile(workspace, "imports/draft.swp", "ignored");

    runCliJson(["init"], workspace.env);

    const vaultFileIds = queryDb<{ id: string }>(workspace, "SELECT id FROM vault_files ORDER BY id").map((row) => row.id);
    const queueFileIds = queryDb<{ fileId: string }>(
      workspace,
      "SELECT file_id AS fileId FROM vault_processing_queue ORDER BY file_id",
    ).map((row) => row.fileId);

    expect(vaultFileIds).toEqual(["config/settings.yaml", "imports/notes.txt", "imports/paper.pdf"]);
    expect(queueFileIds).toEqual(vaultFileIds);
  });

  it("respects custom vaultFileTypes and removes files that fall out of the whitelist", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    bootstrapRuntimeAssets(workspace);
    updateWikiConfig(workspace, (config) => {
      config.vaultFileTypes = ["pdf"];
    });

    writeVaultFile(workspace, "imports/paper.pdf", "paper");
    writeVaultFile(workspace, "imports/notes.txt", "notes");

    runCliJson(["init"], workspace.env);

    let vaultFileIds = queryDb<{ id: string }>(workspace, "SELECT id FROM vault_files ORDER BY id").map((row) => row.id);
    expect(vaultFileIds).toEqual(["imports/paper.pdf"]);

    updateWikiConfig(workspace, (config) => {
      config.vaultFileTypes = ["txt"];
    });

    runCliJson(["sync"], workspace.env);

    vaultFileIds = queryDb<{ id: string }>(workspace, "SELECT id FROM vault_files ORDER BY id").map((row) => row.id);
    const queueFileIds = queryDb<{ fileId: string }>(
      workspace,
      "SELECT file_id AS fileId FROM vault_processing_queue ORDER BY file_id",
    ).map((row) => row.fileId);

    expect(vaultFileIds).toEqual(["imports/notes.txt"]);
    expect(queueFileIds).toEqual(["imports/notes.txt"]);
  });
});
