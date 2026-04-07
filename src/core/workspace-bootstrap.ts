import path from "node:path";

import {
  copyDirectoryContentsSync,
  copyFileIfMissingSync,
  ensureDirSync,
  isDirectoryEmptySync,
  pathExistsSync,
} from "../utils/fs.js";

export interface WorkspaceBootstrapPaths {
  packageRoot: string;
  wikiRoot: string;
  wikiPath: string;
  vaultPath?: string;
  templatesPath: string;
  configPath: string;
}

export interface WorkspaceBootstrapResult {
  copiedConfig: boolean;
  copiedTemplates: number;
  createdDirectories: string[];
}

function ensureDirectory(dirPath: string, createdDirectories: string[]): void {
  if (!pathExistsSync(dirPath)) {
    createdDirectories.push(dirPath);
  }
  ensureDirSync(dirPath);
}

export function scaffoldWorkspaceAssets(paths: WorkspaceBootstrapPaths): WorkspaceBootstrapResult {
  const createdDirectories: string[] = [];
  ensureDirectory(paths.wikiRoot, createdDirectories);
  ensureDirectory(paths.wikiPath, createdDirectories);
  ensureDirectory(paths.templatesPath, createdDirectories);
  if (paths.vaultPath) {
    ensureDirectory(paths.vaultPath, createdDirectories);
  }

  const defaultConfigPath = path.join(paths.packageRoot, "assets", "wiki.config.default.json");
  const defaultTemplatesPath = path.join(paths.packageRoot, "assets", "templates");

  const copiedConfig = copyFileIfMissingSync(defaultConfigPath, paths.configPath);
  let copiedTemplates = 0;
  if (isDirectoryEmptySync(paths.templatesPath) && pathExistsSync(defaultTemplatesPath)) {
    copyDirectoryContentsSync(defaultTemplatesPath, paths.templatesPath);
    copiedTemplates = 1;
  }

  return {
    copiedConfig,
    copiedTemplates,
    createdDirectories,
  };
}
