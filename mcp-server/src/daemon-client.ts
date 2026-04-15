import { setTimeout as delay } from "node:timers/promises";

export class DaemonHttpError extends Error {
  constructor(
    message: string,
    readonly type: string,
    readonly httpStatus: number,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "DaemonHttpError";
  }
}

export interface DaemonRequestOptions {
  env?: NodeJS.ProcessEnv;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

function parsePort(rawValue: string | undefined): number | null {
  if (!rawValue || !rawValue.trim()) {
    return null;
  }
  const value = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid WIKI_DAEMON_PORT: ${rawValue}`);
  }
  return value;
}

export function resolveDaemonBaseUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const rawBaseUrl = env.WIKI_DAEMON_BASE_URL?.trim();
  if (rawBaseUrl) {
    return new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
  }

  const port = parsePort(env.WIKI_DAEMON_PORT);
  if (port === null) {
    throw new Error("WIKI_DAEMON_BASE_URL or WIKI_DAEMON_PORT is required for the MCP adapter.");
  }

  const host = env.WIKI_DAEMON_HOST?.trim() || "127.0.0.1";
  return new URL(`http://${host}:${port}/`);
}

function buildUrl(
  baseUrl: URL,
  routePath: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): URL {
  const url = new URL(routePath.startsWith("/") ? routePath.slice(1) : routePath, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

export async function requestDaemonJson<T>(options: DaemonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? (options.method === "POST" ? 310_000 : 10_000);
  const timer = delay(timeout, undefined, { signal: controller.signal }).then(() => controller.abort()).catch(() => undefined);

  try {
    const response = await fetch(buildUrl(resolveDaemonBaseUrl(options.env), options.path, options.query), {
      method: options.method,
      headers: options.body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
      throw new DaemonHttpError(message, type, response.status, details);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DaemonHttpError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new DaemonHttpError(`Daemon request timed out after ${timeout}ms.`, "runtime", 504, {
        code: "timeout",
      });
    }
    throw new DaemonHttpError(error instanceof Error ? error.message : String(error), "runtime", 500, {
      code: "transport_error",
    });
  } finally {
    controller.abort();
    await timer;
  }
}
