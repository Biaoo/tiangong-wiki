import { getTemplate } from "../core/config.js";
import { createPageFromTemplate } from "../core/page-files.js";
import { loadRuntimeConfig } from "../core/runtime.js";
import { syncWorkspace, type SyncOptions } from "../core/sync.js";

export interface CreatePageOptions {
  type: string;
  title: string;
  nodeId?: string;
}

export async function runSync(
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<SyncOptions, "env"> = {},
) {
  return syncWorkspace({
    ...options,
    env,
  });
}

export async function createPage(
  env: NodeJS.ProcessEnv = process.env,
  options: CreatePageOptions,
): Promise<{ created: string; filePath: string }> {
  const { paths, config } = loadRuntimeConfig(env);
  getTemplate(config, options.type);
  const created = createPageFromTemplate(paths, config, {
    pageType: options.type,
    title: options.title,
    nodeId: options.nodeId ?? undefined,
  });
  await syncWorkspace({
    env,
    targetPaths: [created.pageId],
  });

  return {
    created: created.pageId,
    filePath: created.filePath,
  };
}
