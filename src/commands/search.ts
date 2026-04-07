import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { searchPages } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Run semantic search over page summary embeddings")
    .argument("<query>", "Natural language query")
    .option("--type <pageType>", "Optional pageType filter")
    .option("--limit <number>", "Max rows to return", "10")
    .action(async (query, options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          searchPages(process.env, {
            query,
            type: options.type ?? undefined,
            limit: options.limit ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/search",
            query: {
              query,
              type: options.type ?? undefined,
              limit: options.limit ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });
}
