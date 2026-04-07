import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { runSync } from "../operations/write.js";
import { writeJson } from "../utils/output.js";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Incrementally sync wiki pages, embeddings, and vault metadata")
    .option("--path <pagePath>", "Only sync a single wiki page")
    .option("--force", "Force a full rebuild of the index")
    .option("--skip-embedding", "Skip embedding generation")
    .action(async (options) => {
      const result = await executeServerBackedOperation({
        kind: "write",
        local: () =>
          runSync(process.env, {
            targetPaths: options.path ? [options.path] : undefined,
            force: options.force === true,
            skipEmbedding: options.skipEmbedding === true,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "POST",
            path: "/sync",
            body: {
              path: options.path ?? undefined,
              force: options.force === true,
              skipEmbedding: options.skipEmbedding === true,
            },
          }),
      });
      writeJson(result);
    });
}
