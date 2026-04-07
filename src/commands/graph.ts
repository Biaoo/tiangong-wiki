import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { traverseGraph } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerGraphCommand(program: Command): void {
  program
    .command("graph")
    .description("Traverse the wiki graph with recursive CTEs")
    .argument("<root>", "Root nodeId or page id")
    .option("--depth <number>", "Traversal depth", "1")
    .option("--edge-type <edgeType>", "Optional edge type filter")
    .option("--direction <direction>", "outgoing, incoming, or both", "both")
    .action(async (root, options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () =>
          traverseGraph(process.env, {
            root,
            depth: options.depth ?? undefined,
            edgeType: options.edgeType ?? undefined,
            direction: options.direction ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/graph",
            query: {
              root,
              depth: options.depth ?? undefined,
              edgeType: options.edgeType ?? undefined,
              direction: options.direction ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });
}
