import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { renderLintResult, runLint } from "../operations/query.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";

export function registerLintCommand(program: Command): void {
  program
    .command("lint")
    .description("Validate wiki pages, references, and graph integrity")
    .option("--path <pagePath>", "Lint only one page")
    .option("--level <level>", "error, warning, or info", "info")
    .option("--format <format>", "text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          runLint(process.env, {
            path: options.path ?? undefined,
            level: options.level ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/lint",
            query: {
              path: options.path ?? undefined,
              level: options.level ?? undefined,
            },
          }),
      });

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(renderLintResult(payload));
    });
}
