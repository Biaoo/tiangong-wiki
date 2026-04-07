import { AppError } from "../utils/errors.js";
import { resolveRuntimePaths } from "../core/paths.js";
import type { DaemonState } from "../types/page.js";
import { isDaemonProcessRunning, readDaemonPid, readDaemonState } from "./state.js";

type HttpMethod = "GET" | "POST";

export interface DaemonEndpoint {
  pid: number | null;
  host: string;
  port: number;
  state: DaemonState;
}

export interface DaemonAvailability {
  status: "healthy" | "degraded" | "stopped";
  endpoint: DaemonEndpoint | null;
  pid: number | null;
  state: DaemonState | null;
  reason?: string;
}

interface DaemonHealthPayload {
  ok?: boolean;
  service?: string;
  pid?: number;
  host?: string;
  port?: number;
}

function buildBaseUrl(endpoint: Pick<DaemonEndpoint, "host" | "port">): string {
  return `http://${endpoint.host}:${endpoint.port}`;
}

async function fetchJson<T>(input: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const payload = rawText ? (JSON.parse(rawText) as unknown) : null;
    if (!response.ok) {
      const details =
        payload && typeof payload === "object" && payload !== null && "details" in payload
          ? (payload as { details?: unknown }).details
          : { status: response.status };
      const type =
        payload && typeof payload === "object" && payload !== null && "type" in payload
          ? String((payload as { type?: unknown }).type)
          : "runtime";
      const message =
        payload && typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : `Daemon request failed with HTTP ${response.status}`;
      throw new AppError(
        message,
        type === "config" || type === "runtime" || type === "not_found" || type === "not_configured"
          ? type
          : "runtime",
        details,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(`Daemon request timed out after ${timeoutMs}ms`, "runtime");
    }
    throw new AppError(error instanceof Error ? error.message : String(error), "runtime");
  } finally {
    clearTimeout(timeout);
  }
}

async function probeEndpoint(endpoint: DaemonEndpoint): Promise<boolean> {
  const payload = await fetchJson<DaemonHealthPayload>(
    `${buildBaseUrl(endpoint)}/health`,
    { method: "GET" },
    500,
  );

  return (
    payload.ok === true &&
    payload.service === "wiki-daemon" &&
    payload.host === endpoint.host &&
    payload.port === endpoint.port &&
    (endpoint.pid === null || payload.pid === endpoint.pid)
  );
}

export async function inspectDaemonAvailability(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DaemonAvailability> {
  const paths = resolveRuntimePaths(env);
  const state = readDaemonState(paths.daemonStatePath);
  const pid = state?.pid ?? readDaemonPid(paths.daemonPidPath);
  if (!isDaemonProcessRunning(pid)) {
    return {
      status: "stopped",
      endpoint: null,
      pid,
      state,
      reason: "no_running_process",
    };
  }

  if (!state) {
    return {
      status: "degraded",
      endpoint: null,
      pid,
      state: null,
      reason: "missing_state",
    };
  }

  const endpoint: DaemonEndpoint = {
    pid,
    host: state.host,
    port: state.port,
    state,
  };

  try {
    const healthy = await probeEndpoint(endpoint);
    return {
      status: healthy ? "healthy" : "degraded",
      endpoint: healthy ? endpoint : null,
      pid,
      state,
      reason: healthy ? undefined : "health_check_failed",
    };
  } catch {
    return {
      status: "degraded",
      endpoint: null,
      pid,
      state,
      reason: "health_check_failed",
    };
  }
}

function buildUrl(
  endpoint: DaemonEndpoint,
  routePath: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(`${buildBaseUrl(endpoint)}${routePath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function requestDaemonJson<T>(options: {
  env?: NodeJS.ProcessEnv;
  endpoint?: DaemonEndpoint;
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}): Promise<T> {
  let endpoint = options.endpoint ?? null;
  if (!endpoint) {
    const availability = await inspectDaemonAvailability(options.env);
    if (availability.status !== "healthy" || !availability.endpoint) {
      throw new AppError("Wiki daemon is not healthy", "runtime", availability);
    }
    endpoint = availability.endpoint;
  }

  return fetchJson<T>(
    buildUrl(endpoint, options.path, options.query),
    {
      method: options.method,
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    5_000,
  );
}

function warnReadFallback(availability: DaemonAvailability): void {
  const location = availability.state
    ? `${availability.state.host}:${availability.state.port}`
    : "unknown daemon endpoint";
  process.stderr.write(
    `[wiki] daemon is running but unhealthy at ${location}; falling back to local read execution.\n`,
  );
}

export async function executeServerBackedOperation<T>(options: {
  env?: NodeJS.ProcessEnv;
  kind: "read" | "write";
  local: () => Promise<T> | T;
  remote: (endpoint: DaemonEndpoint) => Promise<T>;
}): Promise<T> {
  const availability = await inspectDaemonAvailability(options.env);

  if (availability.status === "healthy" && availability.endpoint) {
    return options.remote(availability.endpoint);
  }

  if (availability.status === "degraded") {
    if (options.kind === "write") {
      throw new AppError(
        "Wiki daemon is running but unavailable; refusing to bypass daemon for a write operation.",
        "runtime",
        availability,
      );
    }
    warnReadFallback(availability);
  }

  return options.local();
}
