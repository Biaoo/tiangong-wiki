import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureWikiSkillInstall,
  installParserSkill,
  parseParserSkills,
  resolveWorkspaceSkillPaths,
} from "../../src/core/workspace-skills.js";

describe("workspace skills", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("parses parser skills and rejects unknown names in strict mode", () => {
    expect(parseParserSkills("pdf, docx,pdf")).toEqual(["pdf", "docx"]);
    expect(parseParserSkills("", { strict: false })).toEqual([]);
    expect(() => parseParserSkills("pdf,unknown")).toThrow(/unsupported skills/i);
  });

  it("creates a workspace-local tiangong-wiki-skill symlink", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiki-workspace-skills-"));
    tempDirs.push(root);

    const wikiPath = path.join(root, "wiki", "pages");
    const packageRoot = path.join(root, "package");
    mkdirSync(wikiPath, { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, "SKILL.md"), "---\nname: tiangong-wiki-skill\ndescription: test\n---\n", "utf8");

    const installed = ensureWikiSkillInstall(wikiPath, packageRoot);
    const paths = resolveWorkspaceSkillPaths(wikiPath);

    expect(installed.skillPath).toBe(paths.wikiSkillPath);
    expect(installed.status).toBe("linked");
  });

  it("replaces an existing copied tiangong-wiki-skill directory with a symlink", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiki-workspace-skills-"));
    tempDirs.push(root);

    const wikiPath = path.join(root, "wiki", "pages");
    const packageRoot = path.join(root, "package");
    const copiedSkillPath = path.join(root, ".agents", "skills", "tiangong-wiki-skill");
    mkdirSync(wikiPath, { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(copiedSkillPath, { recursive: true });
    writeFileSync(path.join(packageRoot, "SKILL.md"), "---\nname: tiangong-wiki-skill\ndescription: package\n---\n", "utf8");
    writeFileSync(path.join(copiedSkillPath, "SKILL.md"), "---\nname: tiangong-wiki-skill\ndescription: copied\n---\n", "utf8");

    const installed = ensureWikiSkillInstall(wikiPath, packageRoot);

    expect(installed.status).toBe("updated");
    expect(lstatSync(copiedSkillPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(copiedSkillPath)).toBe(realpathSync(packageRoot));
  });

  it("installs parser skills through the external installer command", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiki-workspace-skills-"));
    tempDirs.push(root);

    const workspaceRoot = path.join(root, "workspace");
    const fakeBin = path.join(root, "bin");
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });

    const fakeNpx = path.join(fakeBin, "npx");
    writeFileSync(
      fakeNpx,
      [
        "#!/bin/sh",
        "skill_name=\"\"",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = \"--skill\" ]; then",
        "    shift",
        "    skill_name=\"$1\"",
        "  fi",
        "  shift",
        "done",
        "mkdir -p \"$PWD/.agents/skills/$skill_name\"",
        "printf '%s\\n' '---' \"name: $skill_name\" 'description: fake' '---' > \"$PWD/.agents/skills/$skill_name/SKILL.md\"",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(fakeNpx, 0o755);

    const result = installParserSkill("pdf", workspaceRoot, {
      env: {
        ...process.env,
        PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
      },
    });

    expect(result.status).toBe("installed");
    expect(result.skillMdPath).toBe(path.join(workspaceRoot, ".agents", "skills", "pdf", "SKILL.md"));
  });
});
