import { Command } from "commander";

import { addManagedSkill, getManagedSkillStatus, updateManagedSkills } from "../core/workspace-skills.js";
import { AppError } from "../utils/errors.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";

function renderSkillStatus(payload: { skills: Array<{ name: string; state: string; message: string }> }): string {
  return payload.skills.map((item) => `${item.name}: ${item.state}\n  ${item.message}`).join("\n");
}

function resolveTargetNames(
  name: string | undefined,
  all: boolean,
  options: { requireSelection?: boolean } = {},
): string[] | undefined {
  if (name && all) {
    throw new AppError("Pass either a skill name or --all, not both.", "config");
  }
  if (!name && !all && options.requireSelection) {
    throw new AppError("Pass a skill name or --all.", "config");
  }
  if (!name && !all) {
    return undefined;
  }
  return name ? [name] : undefined;
}

export function registerSkillCommand(program: Command): void {
  const skill = program.command("skill").description("Inspect, install, and update workspace-local managed skills");

  skill
    .command("add")
    .argument("<source>", "Skill source repo URL or local path")
    .requiredOption("--skill <name>", "Skill name")
    .option("--force", "Replace local conflicting changes with the latest managed snapshot")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (source: string, options: { skill?: string; force?: boolean; format?: string }) => {
      const format = ensureTextOrJson(options.format);
      const payload = {
        results: [
          addManagedSkill(process.env, source, options.skill ?? "", {
            force: Boolean(options.force),
          }),
        ],
      };
      if (format === "json") {
        writeJson(payload);
        return;
      }
      writeText(
        payload.results
          .map((item) => `${item.name}: ${item.action} (${item.state})\n  ${item.message}`)
          .join("\n"),
      );
    });

  skill
    .command("status")
    .argument("[name]", "Optional skill name")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (name: string | undefined, options: { format?: string }) => {
      const format = ensureTextOrJson(options.format);
      const payload = { skills: getManagedSkillStatus(process.env, name ? [name] : undefined) };
      if (format === "json") {
        writeJson(payload);
        return;
      }
      writeText(renderSkillStatus(payload));
    });

  skill
    .command("update")
    .argument("[name]", "Optional skill name")
    .option("--all", "Update all managed skills")
    .option("--force", "Replace local conflicting changes with the latest managed snapshot")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (name: string | undefined, options: { all?: boolean; force?: boolean; format?: string }) => {
      const format = ensureTextOrJson(options.format);
      const payload = {
        results: updateManagedSkills(
          process.env,
          resolveTargetNames(name, Boolean(options.all), { requireSelection: true }),
          {
          force: Boolean(options.force),
          },
        ),
      };
      if (format === "json") {
        writeJson(payload);
        return;
      }
      writeText(
        payload.results
          .map((item) => `${item.name}: ${item.action} (${item.state})\n  ${item.message}`)
          .join("\n"),
      );
    });
}
