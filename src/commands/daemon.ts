import { Command } from "commander";

import { getMeta } from "../core/db.js";
import { resolveRuntimePaths } from "../core/paths.js";
import { openRuntimeDb } from "../core/runtime.js";
import { inspectDaemonAvailability, requestDaemonJson } from "../daemon/client.js";
import { runDaemonServer } from "../daemon/server.js";
import { clearDaemonArtifacts, isDaemonProcessRunning, readDaemonPid, readDaemonState, writeDaemonPid } from "../daemon/state.js";
import type { DaemonState } from "../types/page.js";
import { AppError } from "../utils/errors.js";
import { pathExistsSync } from "../utils/fs.js";
import { ensureTextOrJson, writeJson, writeText } from "../utils/output.js";
import { spawnDetachedCurrentProcess } from "../utils/process.js";

interface StatusPayload {
  running: boolean;
  pid: number | null;
  host: string | null;
  port: number | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastResult: "ok" | "error" | null;
  syncIntervalSeconds: number | null;
  launchMode: "run" | "start" | null;
  currentTask: string | null;
  state: DaemonState | null;
}

const DAEMON_STARTUP_TIMEOUT_MS = 5_000;
const DAEMON_STARTUP_POLL_MS = 100;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDaemonRunLaunchMode(env: NodeJS.ProcessEnv = process.env): "run" | "start" {
  return env.WIKI_DAEMON_LAUNCH_MODE === "start" ? "start" : "run";
}

function readLastSyncAt(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const { db } = openRuntimeDb(env);
    try {
      return getMeta(db, "last_sync_at");
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function buildFallbackStatus(env: NodeJS.ProcessEnv = process.env): StatusPayload {
  const paths = resolveRuntimePaths(env);
  const pidFromPidFile = readDaemonPid(paths.daemonPidPath);
  const state = readDaemonState(paths.daemonStatePath);
  const pid = state?.pid ?? pidFromPidFile;
  const running = isDaemonProcessRunning(pid);

  return {
    running,
    pid,
    host: state?.host ?? null,
    port: state?.port ?? null,
    lastSyncAt: readLastSyncAt(env),
    nextSyncAt: state?.nextRunAt ?? null,
    lastResult: state?.lastResult ?? null,
    syncIntervalSeconds: state?.syncIntervalSeconds ?? null,
    launchMode: state?.launchMode ?? null,
    currentTask: state?.currentTask ?? null,
    state,
  };
}

async function stopViaSignal(pid: number, env: NodeJS.ProcessEnv = process.env): Promise<{ status: string; pid: number | null }> {
  const paths = resolveRuntimePaths(env);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      clearDaemonArtifacts(paths);
      return { status: "stopped", pid: null };
    }
    throw error;
  }

  for (let index = 0; index < 10; index += 1) {
    if (!isDaemonProcessRunning(pid)) {
      clearDaemonArtifacts(paths);
      return { status: "stopped", pid: null };
    }
    await sleep(100);
  }

  return { status: "stopping", pid };
}

async function waitForHealthyDaemon(expectedPid: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = resolveRuntimePaths(env);
  const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const availability = await inspectDaemonAvailability(env);
    if (availability.status === "healthy" && availability.pid === expectedPid) {
      return;
    }

    if (!isDaemonProcessRunning(expectedPid)) {
      clearDaemonArtifacts(paths);
      throw new AppError(`Failed to start daemon. Check ${paths.daemonLogPath} for details.`, "runtime");
    }

    await sleep(DAEMON_STARTUP_POLL_MS);
  }

  await stopViaSignal(expectedPid, env).catch(() => undefined);
  clearDaemonArtifacts(paths);
  throw new AppError(
    `Timed out waiting for daemon to become healthy. Check ${paths.daemonLogPath} for details.`,
    "runtime",
  );
}

function renderStatusText(payload: StatusPayload): string {
  return [
    "tiangong-wiki daemon status",
    `running: ${payload.running}`,
    `pid: ${payload.pid ?? ""}`,
    `host: ${payload.host ?? ""}`,
    `port: ${payload.port ?? ""}`,
    `lastSyncAt: ${payload.lastSyncAt ?? ""}`,
    `nextSyncAt: ${payload.nextSyncAt ?? ""}`,
    `lastResult: ${payload.lastResult ?? ""}`,
    `syncIntervalSeconds: ${payload.syncIntervalSeconds ?? ""}`,
    `launchMode: ${payload.launchMode ?? ""}`,
    `currentTask: ${payload.currentTask ?? ""}`,
  ].join("\n");
}

export function registerDaemonCommand(program: Command): void {
  const daemon = program.command("daemon").description("Manage the background sync daemon");

  daemon
    .command("start")
    .description("Start the wiki daemon as a detached local background service")
    .action(async () => {
      const paths = resolveRuntimePaths(process.env);
      const availability = await inspectDaemonAvailability(process.env);
      if (availability.status === "healthy" || availability.status === "degraded") {
        throw new AppError(`Daemon is already running with PID ${availability.pid}`, "runtime", availability);
      }

      if (pathExistsSync(paths.daemonPidPath) || pathExistsSync(paths.daemonStatePath)) {
        clearDaemonArtifacts(paths);
      }

      const pid = spawnDetachedCurrentProcess(["daemon", "run"], {
        env: {
          ...process.env,
          WIKI_DAEMON_LAUNCH_MODE: "start",
        },
        logFile: paths.daemonLogPath,
      });
      if (!pid) {
        throw new AppError("Failed to start daemon", "runtime");
      }

      writeDaemonPid(paths.daemonPidPath, pid);
      await waitForHealthyDaemon(pid, process.env);
      writeJson({ status: "started", pid });
    });

  daemon
    .command("stop")
    .description("Stop the wiki daemon")
    .action(async () => {
      const availability = await inspectDaemonAvailability(process.env);
      if (availability.status === "healthy" && availability.endpoint) {
        writeJson(
          await requestDaemonJson<{ status: string; pid: number | null }>({
            endpoint: availability.endpoint,
            method: "POST",
            path: "/shutdown",
          }),
        );
        return;
      }

      const paths = resolveRuntimePaths(process.env);
      const pid = availability.pid ?? readDaemonPid(paths.daemonPidPath);
      if (!isDaemonProcessRunning(pid)) {
        clearDaemonArtifacts(paths);
        writeJson({ status: "stopped", pid: null });
        return;
      }

      writeJson(await stopViaSignal(pid!, process.env));
    });

  daemon
    .command("status")
    .description("Show daemon state and scheduling information")
    .option("--format <format>", "text or json", "text")
    .action(async (options) => {
      const format = ensureTextOrJson(options.format);
      const availability = await inspectDaemonAvailability(process.env);
      const payload =
        availability.status === "healthy" && availability.endpoint
          ? await requestDaemonJson<StatusPayload>({
              endpoint: availability.endpoint,
              method: "GET",
              path: "/status",
            })
          : buildFallbackStatus(process.env);

      if (format === "json") {
        writeJson(payload);
        return;
      }

      writeText(renderStatusText(payload));
    });

  daemon
    .command("run")
    .description("Run the wiki daemon in the foreground")
    .action(async () => {
      await runDaemonServer({
        env: process.env,
        launchMode: resolveDaemonRunLaunchMode(process.env),
      });
    });
}
