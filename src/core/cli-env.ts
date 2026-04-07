import path from "node:path";

import { pathExistsSync, readTextFileSync } from "../utils/fs.js";

export const DEFAULT_WIKI_ENV_FILE = ".wiki.env";

export interface CliEnvInfo {
  requestedPath: string | null;
  loadedPath: string | null;
  autoDiscovered: boolean;
  missingRequestedPath: boolean;
  loadedKeys: string[];
}

const EMPTY_INFO: CliEnvInfo = {
  requestedPath: null,
  loadedPath: null,
  autoDiscovered: false,
  missingRequestedPath: false,
  loadedKeys: [],
};

let lastCliEnvInfo: CliEnvInfo = EMPTY_INFO;

const CORE_RUNTIME_ENV_KEYS = [
  "WIKI_PATH",
  "VAULT_PATH",
  "WIKI_DB_PATH",
  "WIKI_CONFIG_PATH",
  "WIKI_TEMPLATES_PATH",
] as const;

function unquoteEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length < 2) {
    return value;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function findNearestEnvFile(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, DEFAULT_WIKI_ENV_FILE);
    if (pathExistsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function parseEnvFile(text: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1);
    if (!key) {
      continue;
    }

    entries[key] = unquoteEnvValue(value);
  }

  return entries;
}

function hasExplicitCoreRuntimeEnv(targetEnv: NodeJS.ProcessEnv): boolean {
  return CORE_RUNTIME_ENV_KEYS.some((key) => {
    const value = targetEnv[key];
    return value !== undefined && value.trim().length > 0;
  });
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

export function serializeEnvEntries(entries: Array<[string, string | null | undefined]>): string {
  return `${entries
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${quoteEnvValue(String(value))}`)
    .join("\n")}\n`;
}

export function applyCliEnvironment(
  targetEnv: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): CliEnvInfo {
  const requestedEnvFile = targetEnv.WIKI_ENV_FILE?.trim();
  const requestedPath = requestedEnvFile ? path.resolve(cwd, requestedEnvFile) : null;

  if (!requestedPath && hasExplicitCoreRuntimeEnv(targetEnv)) {
    lastCliEnvInfo = { ...EMPTY_INFO };
    return lastCliEnvInfo;
  }

  const candidatePath = requestedPath ?? findNearestEnvFile(cwd);

  if (!candidatePath) {
    lastCliEnvInfo = { ...EMPTY_INFO, requestedPath };
    return lastCliEnvInfo;
  }

  if (!pathExistsSync(candidatePath)) {
    lastCliEnvInfo = {
      requestedPath: candidatePath,
      loadedPath: null,
      autoDiscovered: false,
      missingRequestedPath: requestedPath !== null,
      loadedKeys: [],
    };
    return lastCliEnvInfo;
  }

  const parsed = parseEnvFile(readTextFileSync(candidatePath));
  const loadedKeys: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (targetEnv[key] === undefined) {
      targetEnv[key] = value;
      loadedKeys.push(key);
    }
  }

  if (!targetEnv.WIKI_ENV_FILE) {
    targetEnv.WIKI_ENV_FILE = candidatePath;
  }

  lastCliEnvInfo = {
    requestedPath,
    loadedPath: candidatePath,
    autoDiscovered: requestedPath === null,
    missingRequestedPath: false,
    loadedKeys,
  };
  return lastCliEnvInfo;
}

export function getCliEnvironmentInfo(): CliEnvInfo {
  return lastCliEnvInfo;
}
