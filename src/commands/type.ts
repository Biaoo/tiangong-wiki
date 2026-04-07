import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { listTypes, recommendTypes, showType } from "../operations/type-template.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";

export function registerTypeCommand(program: Command): void {
  const typeCommand = program.command("type").description("Inspect and recommend wiki page types");

  typeCommand
    .command("list")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => listTypes(process.env),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/type/list",
          }),
      });

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(payload.map((entry) => `${entry.pageType} -> ${entry.file}`).join("\n"));
    });

  typeCommand
    .command("show")
    .argument("<pageType>", "Registered pageType")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (pageType, options) => {
      const format = ensureTextOrJson(options.format);
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => showType(process.env, pageType),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/type/show",
            query: { pageType },
          }),
      });

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(
        [
          `pageType: ${payload.pageType}`,
          `file: ${payload.file}`,
          `columns: ${Object.keys((payload.columns as Record<string, unknown>) ?? {}).join(", ") || "(none)"}`,
          `edges: ${Object.keys((payload.edges as Record<string, unknown>) ?? {}).join(", ") || "(none)"}`,
          `summaryFields: ${(payload.summaryFields as string[]).join(", ") || "(none)"}`,
        ].join("\n"),
      );
    });

  typeCommand
    .command("recommend")
    .requiredOption("--text <text>", "Short summary or extracted content")
    .option("--keywords <keywords>", "Comma-separated keywords")
    .option("--limit <limit>", "Max number of recommendations", "5")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          recommendTypes(process.env, {
            text: String(options.text ?? ""),
            keywords: options.keywords ?? undefined,
            limit: options.limit ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "POST",
            path: "/type/recommend",
            body: {
              text: String(options.text ?? ""),
              keywords: options.keywords ?? undefined,
              limit: options.limit ?? undefined,
            },
          }),
      });

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(
        payload.recommendations
          .map((entry) => `${entry.pageType} (${entry.score.toFixed(4)}) ${entry.signals.join(" | ")}`)
          .join("\n"),
      );
    });
}
