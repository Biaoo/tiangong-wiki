import { Command } from "commander";

import { EmbeddingClient } from "../core/embedding.js";
import { resolveRuntimePaths } from "../core/paths.js";
import { syncWorkspace } from "../core/sync.js";
import { getWikiAgentStatus } from "../core/vault-processing.js";
import { scaffoldWorkspaceAssets } from "../core/workspace-bootstrap.js";
import { AppError } from "../utils/errors.js";
import { spawnDetachedCurrentProcess } from "../utils/process.js";
import { writeJson } from "../utils/output.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize wiki workspace assets and run the first structured sync")
    .option("--force", "Force a full rebuild of the index")
    .action(async (options) => {
      const paths = resolveRuntimePaths(process.env);
      const bootstrap = scaffoldWorkspaceAssets({
        packageRoot: paths.packageRoot,
        wikiRoot: paths.wikiRoot,
        wikiPath: paths.wikiPath,
        vaultPath: paths.vaultPath,
        templatesPath: paths.templatesPath,
        configPath: paths.configPath,
      });

      const structuredSync = await syncWorkspace({
        force: options.force === true,
        skipEmbedding: true,
      });

      let backgroundEmbeddingStarted = false;
      let backgroundPid: number | undefined;
      if (EmbeddingClient.fromEnv(process.env)) {
        backgroundPid = spawnDetachedCurrentProcess(["embed-pending"], { env: process.env });
        backgroundEmbeddingStarted = typeof backgroundPid === "number";
      }

      const wikiAgent = getWikiAgentStatus(process.env);
      if (wikiAgent.enabled && wikiAgent.missing.length > 0) {
        throw new AppError(
          `WIKI_AGENT_ENABLED=true but missing required settings: ${wikiAgent.missing.join(", ")}`,
          "config",
        );
      }

      writeJson({
        initialized: true,
        copiedConfig: bootstrap.copiedConfig,
        copiedTemplates: bootstrap.copiedTemplates,
        sync: structuredSync,
        backgroundEmbeddingStarted,
        ...(backgroundEmbeddingStarted ? { backgroundPid } : {}),
        backgroundQueueProcessingStarted: false,
      });
    });
}
