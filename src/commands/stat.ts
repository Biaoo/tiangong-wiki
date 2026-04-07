import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { getWikiStat } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerStatCommand(program: Command): void {
  program
    .command("stat")
    .description("Show aggregate wiki index statistics")
    .action(async () => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => getWikiStat(process.env),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/stat",
          }),
      });
      writeJson(payload);
    });
}
