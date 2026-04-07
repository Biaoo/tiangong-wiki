import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { exportGraphContent } from "../operations/export.js";
import { writeJson, writeText } from "../utils/output.js";
import { writeTextFileSync } from "../utils/fs.js";

export function registerExportGraphCommand(program: Command): void {
  program
    .command("export-graph")
    .description("Export graph nodes and edges as JSON")
    .option("--output <filePath>", "Write JSON to a file")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => exportGraphContent(process.env),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "POST",
            path: "/export/graph",
          }),
      });
      const content = `${JSON.stringify(payload, null, 2)}\n`;
      if (options.output) {
        writeTextFileSync(options.output, content);
        writeJson({ output: options.output, nodes: payload.nodes.length, edges: payload.edges.length });
        return;
      }

      writeText(content);
    });
}
