import path from "node:path";

import { Command } from "commander";

import { inspectDaemonAvailability, type DaemonEndpoint } from "../daemon/client.js";
import { clearDaemonArtifacts, isDaemonProcessRunning, writeDaemonPid } from "../daemon/state.js";
import { resolveRuntimePaths } from "../core/paths.js";
import { AppError } from "../utils/errors.js";
import { pathExistsSync } from "../utils/fs.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";
import { openTarget, spawnDetachedCurrentProcess } from "../utils/process.js";

const DAEMON_STARTUP_TIMEOUT_MS = 5_000;
const DAEMON_STARTUP_POLL_MS = 100;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getDashboardDistEntry(env: NodeJS.ProcessEnv = process.env): string {
  const paths = resolveRuntimePaths(env);
  return path.join(paths.packageRoot, "dist", "dashboard", "index.html");
}

async function waitForHealthyDaemon(expectedPid: number, env: NodeJS.ProcessEnv = process.env): Promise<DaemonEndpoint> {
  const paths = resolveRuntimePaths(env);
  const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const availability = await inspectDaemonAvailability(env);
    if (availability.status === "healthy" && availability.endpoint && availability.pid === expectedPid) {
      return availability.endpoint;
    }

    if (!isDaemonProcessRunning(expectedPid)) {
      clearDaemonArtifacts(paths);
      throw new AppError(`Failed to start daemon. Check ${paths.daemonLogPath} for details.`, "runtime");
    }

    await sleep(DAEMON_STARTUP_POLL_MS);
  }

  clearDaemonArtifacts(paths);
  throw new AppError(
    `Timed out waiting for daemon to become healthy. Check ${paths.daemonLogPath} for details.`,
    "runtime",
  );
}

async function stopDegradedDaemon(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = resolveRuntimePaths(env);
  const availability = await inspectDaemonAvailability(env);
  if (availability.status !== "degraded" || !availability.pid) {
    return;
  }

  try {
    process.kill(availability.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isDaemonProcessRunning(availability.pid)) {
      clearDaemonArtifacts(paths);
      return;
    }
    await sleep(100);
  }

  clearDaemonArtifacts(paths);
}

async function ensureDashboardDaemon(env: NodeJS.ProcessEnv = process.env): Promise<DaemonEndpoint> {
  const availability = await inspectDaemonAvailability(env);
  if (availability.status === "healthy" && availability.endpoint) {
    return availability.endpoint;
  }

  if (availability.status === "degraded") {
    await stopDegradedDaemon(env);
  }

  const paths = resolveRuntimePaths(env);
  const pid = spawnDetachedCurrentProcess(["daemon", "run"], {
    env: {
      ...env,
      WIKI_DAEMON_LAUNCH_MODE: "start",
    },
    logFile: paths.daemonLogPath,
  });
  if (!pid) {
    throw new AppError("Failed to start daemon", "runtime");
  }

  writeDaemonPid(paths.daemonPidPath, pid);
  return waitForHealthyDaemon(pid, env);
}

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Open the local dashboard in a browser, starting the daemon if needed")
    .option("--no-open", "Do not open the dashboard URL in a browser")
    .option("--format <format>", "text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const dashboardEntry = getDashboardDistEntry(process.env);
      if (!pathExistsSync(dashboardEntry)) {
        throw new AppError(
          `Dashboard assets are missing at ${dashboardEntry}. Run \`npm run build\` before opening the dashboard.`,
          "not_found",
        );
      }

      const endpoint = await ensureDashboardDaemon(process.env);
      const url = `http://${endpoint.host}:${endpoint.port}/dashboard`;
      const opened = options.open !== false;
      if (opened) {
        openTarget(url);
      }

      const payload = {
        url,
        opened,
        pid: endpoint.pid,
        host: endpoint.host,
        port: endpoint.port,
      };

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(url);
    });
}
