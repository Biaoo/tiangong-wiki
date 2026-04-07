import { Command } from "commander";

import { getPackageRoot } from "../core/paths.js";
import { runSetupWizard } from "../core/onboarding.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Run the step-by-step wiki configuration wizard")
    .action(async () => {
      await runSetupWizard(process.env, {
        cwd: process.cwd(),
        input: process.stdin,
        output: process.stdout,
        packageRoot: getPackageRoot(),
      });
    });
}
