import { Command } from "commander";

import { executeServerBackedOperation, requestDaemonJson } from "../daemon/client.js";
import { getPageInfo } from "../operations/query.js";
import { writeJson } from "../utils/output.js";

export function registerPageInfoCommand(program: Command): void {
  program
    .command("page-info")
    .description("Show full metadata and edge details for one page")
    .argument("<pageId>", "Page id relative to wiki/pages")
    .action(async (inputPageId) => {
      const payload = await executeServerBackedOperation({
        kind: "read",
        local: () => getPageInfo(process.env, inputPageId),
        remote: (endpoint) =>
          requestDaemonJson({
            endpoint,
            method: "GET",
            path: "/page-info",
            query: {
              pageId: inputPageId,
            },
          }),
      });
      writeJson(payload);
    });
}
