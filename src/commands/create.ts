import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { buildCliWriteActor } from "../daemon/write-actor.js";
import { createPage } from "../operations/write.js";
import { writeJson } from "../utils/output.js";

export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .description("Create a new wiki page from a registered template and index it immediately")
    .requiredOption("--type <pageType>", "Registered pageType")
    .requiredOption("--title <title>", "Page title")
    .option("--node-id <nodeId>", "Optional nodeId")
    .action(async (options) => {
      const result = await executeServerBackedOperation({
        kind: "write",
        local: () =>
          createPage(process.env, {
            type: options.type,
            title: options.title,
            nodeId: options.nodeId ?? undefined,
          }),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "POST",
            path: "/create",
            timeoutMs: 310_000,
            body: {
              actor: buildCliWriteActor(process.env),
              type: options.type,
              title: options.title,
              nodeId: options.nodeId ?? undefined,
            },
          }),
      });
      writeJson(result);
    });
}
