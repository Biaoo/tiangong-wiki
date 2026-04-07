import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSynologyConfigFromEnv, withSynologyClient } from "../../src/core/synology.js";
import { cleanupWorkspace, createWorkspace, readFile, startSynologyServer } from "../helpers.js";

describe("synology client", () => {
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

  it("loads config from env with normalized defaults", () => {
    const config = loadSynologyConfigFromEnv({
      SYNOLOGY_BASE_URL: "https://nas.example.com:5001/",
      SYNOLOGY_USERNAME: "alice",
      SYNOLOGY_PASSWORD: "secret",
      SYNOLOGY_VERIFY_SSL: "false",
      SYNOLOGY_READONLY: "true",
      SYNOLOGY_TIMEOUT: "12",
    });

    expect(config).toMatchObject({
      baseUrl: "https://nas.example.com:5001",
      username: "alice",
      password: "secret",
      verifySsl: false,
      readonly: true,
      timeoutMs: 12_000,
      session: "FileStation",
    });
  });

  it("lists folders, probes remote paths, and downloads files through the DSM WebAPI", async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const server = await startSynologyServer(workspace.root, {
      files: {
        "/vault/reports/spec.pdf": {
          size: 12,
          mtime: 1_700_000_123,
          content: "spec-content",
        },
        "/vault/notes/todo.txt": {
          size: 8,
          mtime: 1_700_000_124,
          content: "todo.txt",
        },
      },
    });
    servers.push(server);

    const env = {
      SYNOLOGY_BASE_URL: server.baseUrl,
      SYNOLOGY_USERNAME: "tester",
      SYNOLOGY_PASSWORD: "secret",
    };
    const outputPath = path.join(workspace.root, "downloads", "spec.pdf");

    await withSynologyClient(env, async (client) => {
      const rootItems = await client.listFolderAll("/vault");
      expect(rootItems.map((item) => item.path)).toEqual(expect.arrayContaining(["/vault/reports", "/vault/notes"]));

      const reportItems = await client.listFolderAll("/vault/reports");
      expect(reportItems.map((item) => item.path)).toContain("/vault/reports/spec.pdf");

      await client.probeFolder("/vault/reports");
      await client.downloadFile("/vault/reports/spec.pdf", outputPath);
    });

    expect(readFile(outputPath)).toBe("spec-content");
  });
});
