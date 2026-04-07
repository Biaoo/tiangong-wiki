import { spawn } from "node:child_process";
import { openSync } from "node:fs";

import { AppError } from "./errors.js";

interface Invocation {
  command: string;
  args: string[];
}

export function getCurrentInvocation(): Invocation {
  const [, argv1, argv2] = process.argv;
  if (!argv1) {
    return { command: process.execPath, args: [] };
  }

  const looksLikeTsx = argv1.includes("tsx");
  if (looksLikeTsx && argv2) {
    return {
      command: process.execPath,
      args: [argv1, argv2],
    };
  }

  return {
    command: process.execPath,
    args: [argv1],
  };
}

export function spawnDetachedCurrentProcess(
  extraArgs: string[],
  options: { env?: NodeJS.ProcessEnv; logFile?: string } = {},
): number | undefined {
  const invocation = getCurrentInvocation();
  const stdio: "ignore" | ["ignore", number, number] = options.logFile
    ? ["ignore", openSync(options.logFile, "a"), openSync(options.logFile, "a")]
    : "ignore";

  const child = spawn(invocation.command, [...invocation.args, ...extraArgs], {
    detached: true,
    stdio,
    env: options.env ?? process.env,
  });
  child.unref();
  return child.pid;
}

export function openTarget(target: string): void {
  let command = "";
  let args: string[] = [];

  if (process.platform === "darwin") {
    command = "open";
    args = [target];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", target];
  } else {
    command = "xdg-open";
    args = [target];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
  } catch (error) {
    throw new AppError(
      `Failed to open target ${target}: ${error instanceof Error ? error.message : String(error)}`,
      "runtime",
    );
  }
}
