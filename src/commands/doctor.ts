import { Command } from "commander";

import { buildDoctorReport, formatDoctorReport } from "../core/onboarding.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose the current wiki configuration and runtime health")
    .option("--probe", "Probe configured remote services such as embeddings and Synology NAS")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const report = await buildDoctorReport(process.env, { probe: options.probe === true });

      if (format === "json") {
        writeJson(report);
      } else {
        writeText(formatDoctorReport(report));
      }

      if (!report.ok) {
        process.exitCode = 2;
      }
    });
}
