import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { diffVaultFiles, getVaultQueue, listVaultFiles } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerVaultCommand(program: Command): void {
  const vault = program.command("vault").description("Inspect indexed vault files and changelog entries");

  vault
    .command("list")
    .option("--path <prefix>", "Filter by relative path prefix")
    .option("--ext <ext>", "Filter by file extension")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => listVaultFiles(process.env, options),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/vault/list",
            query: {
              path: options.path ?? undefined,
              ext: options.ext ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });

  vault
    .command("diff")
    .option("--since <date>", "Show changes since a timestamp")
    .option("--path <prefix>", "Filter by relative path prefix")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => diffVaultFiles(process.env, options),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/vault/diff",
            query: {
              since: options.since ?? undefined,
              path: options.path ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });

  vault
    .command("queue")
    .option("--status <status>", "Filter queue items by status")
    .action(async (options) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => getVaultQueue(process.env, options),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/vault/queue",
            query: {
              status: options.status ?? undefined,
            },
          }),
      });
      writeJson(payload);
    });
}
