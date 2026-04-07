import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { exportIndexContent } from "../operations/export.js";
import { writeText } from "../utils/output.js";
import { writeTextFileSync } from "../utils/fs.js";

export function registerExportIndexCommand(program: Command): void {
  program
    .command("export-index")
    .description("Export a human-readable Markdown index of pages")
    .option("--output <filePath>", "Write Markdown output to a file")
    .option("--group-by <mode>", "Group by pageType or tags", "pageType")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          exportIndexContent(process.env, {
            groupBy: options.groupBy ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "POST",
            path: "/export/index",
            body: {
              groupBy: options.groupBy ?? undefined,
            },
          }),
      });

      if (options.output) {
        writeTextFileSync(options.output, `${payload.content}\n`);
      }

      writeText(String(payload.content ?? ""));
    });
}
