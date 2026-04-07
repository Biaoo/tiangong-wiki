import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyCliEnvironment, DEFAULT_WIKI_ENV_FILE } from "../../src/core/cli-env.js";

function createEnvFixture(contents: string): { root: string; cwd: string; envFilePath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "wiki-cli-env-"));
  const cwd = path.join(root, "workspace", "nested");
  const envFilePath = path.join(root, DEFAULT_WIKI_ENV_FILE);

  mkdirSync(cwd, { recursive: true });
  writeFileSync(envFilePath, contents, "utf8");

  return { root, cwd, envFilePath };
}

describe("cli env loading", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("auto-discovers the nearest .wiki.env when no runtime paths are preset", () => {
    const fixture = createEnvFixture(
      [
        "WIKI_PATH=/tmp/discovered/pages",
        "VAULT_PATH=/tmp/discovered/vault",
        "WIKI_CONFIG_PATH=/tmp/discovered/wiki.config.json",
        "",
      ].join("\n"),
    );
    tempDirs.push(fixture.root);

    const env: NodeJS.ProcessEnv = {};
    const info = applyCliEnvironment(env, fixture.cwd);

    expect(info.loadedPath).toBe(fixture.envFilePath);
    expect(info.autoDiscovered).toBe(true);
    expect(info.loadedKeys).toEqual(["WIKI_PATH", "VAULT_PATH", "WIKI_CONFIG_PATH"]);
    expect(env.WIKI_PATH).toBe("/tmp/discovered/pages");
    expect(env.WIKI_ENV_FILE).toBe(fixture.envFilePath);
  });

  it("skips auto-discovery when core runtime paths are already provided", () => {
    const fixture = createEnvFixture(
      [
        "WIKI_CONFIG_PATH=/tmp/discovered/wiki.config.json",
        "WIKI_DB_PATH=/tmp/discovered/index.db",
        "",
      ].join("\n"),
    );
    tempDirs.push(fixture.root);

    const env: NodeJS.ProcessEnv = {
      WIKI_PATH: "/tmp/explicit/pages",
      VAULT_PATH: "/tmp/explicit/vault",
    };
    const info = applyCliEnvironment(env, fixture.cwd);

    expect(info.loadedPath).toBeNull();
    expect(info.autoDiscovered).toBe(false);
    expect(info.loadedKeys).toEqual([]);
    expect(env.WIKI_CONFIG_PATH).toBeUndefined();
    expect(env.WIKI_DB_PATH).toBeUndefined();
    expect(env.WIKI_ENV_FILE).toBeUndefined();
  });

  it("still loads an explicitly requested env file when runtime paths are preset", () => {
    const fixture = createEnvFixture(
      [
        "WIKI_DB_PATH=/tmp/discovered/index.db",
        "WIKI_TEMPLATES_PATH=/tmp/discovered/templates",
        "",
      ].join("\n"),
    );
    tempDirs.push(fixture.root);

    const env: NodeJS.ProcessEnv = {
      WIKI_PATH: "/tmp/explicit/pages",
      WIKI_ENV_FILE: fixture.envFilePath,
    };
    const info = applyCliEnvironment(env, fixture.cwd);

    expect(info.requestedPath).toBe(fixture.envFilePath);
    expect(info.loadedPath).toBe(fixture.envFilePath);
    expect(info.autoDiscovered).toBe(false);
    expect(info.loadedKeys).toEqual(["WIKI_DB_PATH", "WIKI_TEMPLATES_PATH"]);
    expect(env.WIKI_PATH).toBe("/tmp/explicit/pages");
    expect(env.WIKI_DB_PATH).toBe("/tmp/discovered/index.db");
  });
});
