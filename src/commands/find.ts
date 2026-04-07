import type { Command } from "commander";

import type { LoadedWikiConfig } from "../types/config.js";
import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { camelToSnake } from "../utils/case.js";
import { findPages } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerFindCommand(program: Command, config?: LoadedWikiConfig): void {
  const command = program
    .command("find")
    .description("Find wiki pages by structured metadata filters")
    .option("--type <pageType>", "Filter by pageType")
    .option("--status <status>", "Filter by status")
    .option("--visibility <visibility>", "Filter by visibility")
    .option("--tag <tag>", "Filter by tag")
    .option("--node-id <nodeId>", "Filter by nodeId")
    .option("--updated-after <date>", "Filter by updatedAt >= date")
    .option("--sort <column>", "Sort column")
    .option("--limit <number>", "Max rows to return", "50");

  const dynamicFields = config
    ? [...new Set([...Object.keys(config.customColumns), ...Object.values(config.templates).flatMap((template) => Object.keys(template.columns))])]
    : [];

  for (const field of dynamicFields) {
    command.option(`--${camelToSnake(field).replace(/_/g, "-")} <value>`, `Filter by ${field}`);
  }

  command.action(async (options) => {
    const payload = await executeServerBackedOperation({
      kind: "read",
      local: () => findPages(process.env, options),
      remote: (endpoint) =>
        requestDaemonJson({
          endpoint,
          method: "GET",
          path: "/find",
          query: options as Record<string, string | number | boolean | null | undefined>,
        }),
    });
    writeJson(payload);
  });
}
