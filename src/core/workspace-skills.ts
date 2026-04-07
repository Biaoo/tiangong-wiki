import { spawnSync } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

import { AppError } from "../utils/errors.js";
import { ensureDirSync, pathExistsSync } from "../utils/fs.js";

export const PARSER_SKILL_SOURCE = "https://github.com/anthropics/skills";

export const OPTIONAL_PARSER_SKILLS = [
  { name: "pdf", summary: "Process PDF files" },
  { name: "docx", summary: "Process DOCX files" },
  { name: "pptx", summary: "Process PPTX files" },
  { name: "xlsx", summary: "Process XLSX/CSV files" },
] as const;

export type ParserSkillName = (typeof OPTIONAL_PARSER_SKILLS)[number]["name"];

export interface WorkspaceSkillPaths {
  workspaceRoot: string;
  skillsRoot: string;
  wikiSkillPath: string;
}

export interface SkillCheckResult {
  name: string;
  skillPath: string;
  skillMdPath: string;
  exists: boolean;
  readable: boolean;
}

export interface WikiSkillInstallResult {
  sourcePath: string;
  skillPath: string;
  status: "linked" | "updated" | "existing";
}

export interface ParserSkillInstallResult {
  name: ParserSkillName;
  skillPath: string;
  skillMdPath: string;
  status: "installed" | "existing";
  command: string;
}

export interface ParserSkillSelection {
  skills: ParserSkillName[];
  invalid: string[];
}

const OPTIONAL_PARSER_SKILL_NAMES = new Set<ParserSkillName>(OPTIONAL_PARSER_SKILLS.map((skill) => skill.name));

function canRead(filePath: string): boolean {
  accessSync(filePath, constants.R_OK);
  return true;
}

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

export function resolveWorkspaceRootFromWikiPath(wikiPath: string): string {
  return path.resolve(wikiPath, "..", "..");
}

export function resolveWorkspaceSkillPaths(wikiPath: string): WorkspaceSkillPaths {
  const workspaceRoot = resolveWorkspaceRootFromWikiPath(wikiPath);
  const skillsRoot = path.join(workspaceRoot, ".agents", "skills");

  return {
    workspaceRoot,
    skillsRoot,
    wikiSkillPath: path.join(skillsRoot, "wiki-skill"),
  };
}

export function resolveWorkspaceSkillPath(workspaceRoot: string, skillName: string): string {
  return path.join(workspaceRoot, ".agents", "skills", skillName);
}

export function parseParserSkillSelection(rawValue: string | undefined): ParserSkillSelection {
  const value = rawValue?.trim();
  if (!value) {
    return {
      skills: [],
      invalid: [],
    };
  }

  const skills: ParserSkillName[] = [];
  const seen = new Set<ParserSkillName>();
  const invalid: string[] = [];

  for (const entry of value.split(",")) {
    const candidate = entry.trim().toLowerCase();
    if (!candidate) {
      continue;
    }

    if (!OPTIONAL_PARSER_SKILL_NAMES.has(candidate as ParserSkillName)) {
      invalid.push(candidate);
      continue;
    }

    const skill = candidate as ParserSkillName;
    if (!seen.has(skill)) {
      seen.add(skill);
      skills.push(skill);
    }
  }

  return {
    skills,
    invalid,
  };
}

export function parseParserSkills(
  rawValue: string | undefined,
  options: { strict?: boolean } = {},
): ParserSkillName[] {
  const { skills, invalid } = parseParserSkillSelection(rawValue);

  if (invalid.length > 0 && options.strict !== false) {
    throw new AppError(
      `WIKI_PARSER_SKILLS contains unsupported skills: ${invalid.join(", ")}`,
      "config",
    );
  }

  return skills;
}

export function formatParserSkills(skills: readonly ParserSkillName[]): string {
  return skills.join(",");
}

export function inspectSkillInstall(skillPath: string, name = path.basename(skillPath)): SkillCheckResult {
  const skillMdPath = path.join(skillPath, "SKILL.md");
  if (!pathExistsSync(skillPath)) {
    return {
      name,
      skillPath,
      skillMdPath,
      exists: false,
      readable: false,
    };
  }

  try {
    canRead(skillMdPath);
    return {
      name,
      skillPath,
      skillMdPath,
      exists: true,
      readable: true,
    };
  } catch {
    return {
      name,
      skillPath,
      skillMdPath,
      exists: true,
      readable: false,
    };
  }
}

export function ensureWikiSkillInstall(
  wikiPath: string,
  packageRoot: string,
): WikiSkillInstallResult {
  const paths = resolveWorkspaceSkillPaths(wikiPath);
  const packageRealPath = realpathSync(packageRoot);
  const existing = inspectSkillInstall(paths.wikiSkillPath, "wiki-skill");

  ensureDirSync(paths.skillsRoot);

  if (existing.exists) {
    const stats = lstatSync(paths.wikiSkillPath);
    if (stats.isSymbolicLink()) {
      const currentRealPath = realpathSync(paths.wikiSkillPath);
      if (currentRealPath === packageRealPath) {
        return {
          sourcePath: packageRoot,
          skillPath: paths.wikiSkillPath,
          status: "linked",
        };
      }

      unlinkSync(paths.wikiSkillPath);
      symlinkSync(packageRoot, paths.wikiSkillPath, "dir");
      return {
        sourcePath: packageRoot,
        skillPath: paths.wikiSkillPath,
        status: "updated",
      };
    }

    if (existing.readable) {
      rmSync(paths.wikiSkillPath, { recursive: true, force: true });
      symlinkSync(packageRoot, paths.wikiSkillPath, "dir");
      return {
        sourcePath: packageRoot,
        skillPath: paths.wikiSkillPath,
        status: "updated",
      };
    }

    throw new AppError(
      `workspace skill path is occupied and cannot be reused: ${paths.wikiSkillPath}`,
      "config",
      {
        skillName: "wiki-skill",
        skillPath: paths.wikiSkillPath,
      },
    );
  }

  symlinkSync(packageRoot, paths.wikiSkillPath, "dir");
  return {
    sourcePath: packageRoot,
    skillPath: paths.wikiSkillPath,
    status: "linked",
  };
}

function renderCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/[A-Za-z0-9_./:@+-]+/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

export function buildParserSkillInstallInvocation(skillName: ParserSkillName): {
  command: string;
  args: string[];
  rendered: string;
} {
  const command = getNpxCommand();
  const args = ["-y", "skills", "add", PARSER_SKILL_SOURCE, "--skill", skillName, "-a", "codex", "-y"];
  return {
    command,
    args,
    rendered: renderCommand(command, args),
  };
}

export function installParserSkill(
  skillName: ParserSkillName,
  workspaceRoot: string,
  options: {
    env?: NodeJS.ProcessEnv;
    output?: NodeJS.WritableStream;
  } = {},
): ParserSkillInstallResult {
  const skillPath = resolveWorkspaceSkillPath(workspaceRoot, skillName);
  const current = inspectSkillInstall(skillPath, skillName);
  const invocation = buildParserSkillInstallInvocation(skillName);

  if (current.readable) {
    return {
      name: skillName,
      skillPath,
      skillMdPath: current.skillMdPath,
      status: "existing",
      command: invocation.rendered,
    };
  }

  options.output?.write(`Installing parser skill ${skillName}...\n`);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workspaceRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw new AppError(
      `failed to install parser skill ${skillName}: ${result.error.message}`,
      "runtime",
      {
        skillName,
        command: invocation.rendered,
        cwd: workspaceRoot,
      },
    );
  }

  if (result.status !== 0) {
    throw new AppError(
      `failed to install parser skill ${skillName}`,
      "runtime",
      {
        skillName,
        command: invocation.rendered,
        cwd: workspaceRoot,
        exitCode: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    );
  }

  const installed = inspectSkillInstall(skillPath, skillName);
  if (!installed.readable) {
    throw new AppError(
      `parser skill ${skillName} was installed but SKILL.md is missing or unreadable`,
      "runtime",
      {
        skillName,
        command: invocation.rendered,
        cwd: workspaceRoot,
        skillPath,
        skillMdPath: installed.skillMdPath,
      },
    );
  }

  return {
    name: skillName,
    skillPath,
    skillMdPath: installed.skillMdPath,
    status: "installed",
    command: invocation.rendered,
  };
}
