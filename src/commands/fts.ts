import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { ftsSearchPages } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerFtsCommand(program: Command): void {
  program
    .command("fts")
    .description("Run full-text search over title, tags, and summary text")
    .argument("<query>", "FTS query")
    .option("--type <pageType>", "Optional pageType filter")
    .option("--limit <number>", "Max rows to return", "20")
    .action(async (query, options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          ftsSearchPages(process.env, {
            query,
            type: options.type ?? undefined,
            limit: options.limit ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/fts",
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
