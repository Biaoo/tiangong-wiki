import { realpathSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupWorkspace, createWorkspace, readFile, readJson, runCli } from "../helpers.js";

function stripWikiEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (
      key === "WIKI_ENV_FILE" ||
      key.startsWith("WIKI_") ||
      key.startsWith("VAULT_") ||
      key.startsWith("EMBEDDING_") ||
      key.startsWith("OPENROUTER_")
    ) {
      delete next[key];
    }
  }
  return next;
}

describe("setup and doctor integration", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  it("runs the interactive setup wizard, writes .wiki.env, and lets doctor/init reuse it automatically", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const env = stripWikiEnv(workspace.env);
    const answers = [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "n",
      "n",
      "y",
      "",
    ].join("\n");

    const setup = runCli(["setup"], env, {
      cwd: workspace.root,
      input: answers,
    });
    expect(setup.status).toBe(0);
    expect(setup.stdout).toContain("wiki setup complete");

    const envFilePath = `${workspace.root}/.wiki.env`;
    const envFile = readFile(envFilePath);
    expect(envFile).toContain("WIKI_PATH=");
    expect(envFile).toContain("VAULT_PATH=");
    expect(envFile).toContain("WIKI_AGENT_ENABLED=false");

    const doctor = runCli(["doctor", "--format", "json"], env, { cwd: workspace.root });
    expect(doctor.status).toBe(0);
    const report = readJson<{
      ok: boolean;
      envFile: { loadedPath: string | null };
      checks: Array<{ id: string; severity: string }>;
    }>(doctor.stdout);
    expect(report.ok).toBe(true);
    expect(report.envFile.loadedPath).toBe(realpathSync(envFilePath));
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "env-file", severity: "ok" }),
        expect.objectContaining({ id: "config", severity: "ok" }),
      ]),
    );

    const init = runCli(["init"], env, { cwd: workspace.root });
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('"initialized": true');
  });

  it("reports actionable errors when the generated runtime assets are missing", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const env = stripWikiEnv(workspace.env);
    const envFilePath = `${workspace.root}/.wiki.env`;
    const envFile = [
      `WIKI_PATH=${workspace.wikiPath}`,
      `VAULT_PATH=${workspace.vaultPath}`,
      `WIKI_DB_PATH=${workspace.wikiRoot}/index.db`,
      `WIKI_CONFIG_PATH=${workspace.wikiRoot}/wiki.config.json`,
      `WIKI_TEMPLATES_PATH=${workspace.wikiRoot}/templates`,
      "WIKI_SYNC_INTERVAL=86400",
      "",
    ].join("\n");
    writeFileSync(envFilePath, envFile, "utf8");

    const doctor = runCli(["doctor", "--format", "json"], env, {
      cwd: workspace.root,
      allowFailure: true,
    });
    expect(doctor.status).toBe(2);

    const report = readJson<{
      ok: boolean;
      recommendations: string[];
      checks: Array<{ id: string; severity: string; summary: string }>;
    }>(doctor.stdout);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "config", severity: "error" }),
        expect.objectContaining({ id: "templates-path", severity: "error" }),
      ]),
    );
    expect(report.recommendations.join("\n")).toContain("wiki setup");
  });
});
