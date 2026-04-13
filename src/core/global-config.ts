import os from "node:os";
import path from "node:path";

import { AppError } from "../utils/errors.js";
import { ensureDirSync, pathExistsSync, readTextFileSync, writeTextFileSync } from "../utils/fs.js";

export const GLOBAL_CONFIG_DIRNAME = "tiangong-wiki";
export const GLOBAL_CONFIG_FILENAME = "config.json";

interface GlobalConfigFile {
  schemaVersion: number;
  defaultEnvFile: string;
}

export interface LoadedGlobalConfig {
  configPath: string;
  defaultEnvFile: string;
}

function resolveConfigBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    return path.resolve(xdgConfigHome);
  }

  const homeDir = env.HOME?.trim() || os.homedir();
  return path.join(homeDir, ".config");
}

export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveConfigBaseDir(env), GLOBAL_CONFIG_DIRNAME, GLOBAL_CONFIG_FILENAME);
}

export function readGlobalConfig(env: NodeJS.ProcessEnv = process.env): LoadedGlobalConfig | null {
  const configPath = resolveGlobalConfigPath(env);
  if (!pathExistsSync(configPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readTextFileSync(configPath));
  } catch (error) {
    throw new AppError(`Failed to parse global CLI config JSON: ${configPath}`, "config", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(`Global CLI config must be an object: ${configPath}`, "config");
  }

  const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
    throw new AppError(`Global CLI config schemaVersion must be a positive integer: ${configPath}`, "config");
  }

  const defaultEnvFile = (parsed as Record<string, unknown>).defaultEnvFile;
  if (typeof defaultEnvFile !== "string" || defaultEnvFile.trim().length === 0) {
    throw new AppError(`Global CLI config defaultEnvFile must be a non-empty string: ${configPath}`, "config");
  }

  return {
    configPath,
    defaultEnvFile: path.resolve(defaultEnvFile),
  };
}

export function writeGlobalConfig(
  defaultEnvFile: string,
  env: NodeJS.ProcessEnv = process.env,
): LoadedGlobalConfig {
  const configPath = resolveGlobalConfigPath(env);
  const normalizedEnvFile = path.resolve(defaultEnvFile);

  const payload: GlobalConfigFile = {
    schemaVersion: 1,
    defaultEnvFile: normalizedEnvFile,
  };

  ensureDirSync(path.dirname(configPath));
  writeTextFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`);

  return {
    configPath,
    defaultEnvFile: normalizedEnvFile,
  };
}
