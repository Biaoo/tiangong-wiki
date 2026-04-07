import { readFileSync, rmSync } from "node:fs";

import type { DaemonLaunchMode, DaemonState, RuntimePaths } from "../types/page.js";
import { pathExistsSync, writeTextFileSync } from "../utils/fs.js";
import { toOffsetIso } from "../utils/time.js";

export function readDaemonPid(pidPath: string): number | null {
  if (!pathExistsSync(pidPath)) {
    return null;
  }

  const value = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  return Number.isFinite(value) ? value : null;
}

export function isDaemonProcessRunning(pid: number | null): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonState(statePath: string): DaemonState | null {
  if (!pathExistsSync(statePath)) {
    return null;
  }

  return JSON.parse(readFileSync(statePath, "utf8")) as DaemonState;
}

export function writeDaemonState(statePath: string, state: DaemonState): void {
  writeTextFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function writeDaemonPid(pidPath: string, pid: number): void {
  writeTextFileSync(pidPath, `${pid}\n`);
}

export function clearDaemonArtifacts(paths: Pick<RuntimePaths, "daemonPidPath" | "daemonStatePath">): void {
  rmSync(paths.daemonPidPath, { force: true });
  rmSync(paths.daemonStatePath, { force: true });
}

export function createInitialDaemonState(
  paths: Pick<RuntimePaths, "daemonHost" | "syncIntervalSeconds">,
  input: { pid: number; port: number; launchMode: DaemonLaunchMode },
): DaemonState {
  return {
    pid: input.pid,
    host: paths.daemonHost,
    port: input.port,
    launchMode: input.launchMode,
    startedAt: toOffsetIso(),
    lastRunAt: null,
    nextRunAt: null,
    lastResult: null,
    lastError: null,
    syncIntervalSeconds: paths.syncIntervalSeconds,
    currentTask: "idle",
  };
}
