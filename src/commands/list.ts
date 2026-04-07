import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { listPages } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List wiki pages")
    .option("--type <pageType>", "Optional pageType filter")
    .option("--sort <column>", "Sort column", "updatedAt")
    .option("--limit <number>", "Max rows to return", "50")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => listPages(process.env, options),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/list",
            query: {
              type: options.type ?? undefined,
              sort: options.sort ?? undefined,
              limit: options.limit ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });
}
