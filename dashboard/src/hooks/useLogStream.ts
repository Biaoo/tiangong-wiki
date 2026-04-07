import { useEffect, useRef, useState } from "preact/hooks";

import type { DashboardApiClient } from "../api/client";
import type { DashboardLogEntry } from "../types/dashboard";

type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

interface UseLogStreamOptions {
  api: DashboardApiClient;
  level?: "info" | "error";
  fileId?: string;
  query?: string;
  history?: number;
  paused?: boolean;
}

export function useLogStream(options: UseLogStreamOptions): {
  logs: DashboardLogEntry[];
  status: StreamStatus;
  clear: () => void;
} {
  const [logs, setLogs] = useState<DashboardLogEntry[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");

  const knownIdsRef = useRef<Set<number>>(new Set());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (options.paused) {
      closeRef.current?.();
      closeRef.current = null;
      setStatus("idle");
      return;
    }

    let disposed = false;

    const appendEntries = (entries: DashboardLogEntry[]) => {
      if (entries.length === 0) {
        return;
      }

      setLogs((current) => {
        const next = [...current];
        for (const entry of entries) {
          if (knownIdsRef.current.has(entry.id)) {
            continue;
          }
          knownIdsRef.current.add(entry.id);
          next.push(entry);
        }
        return next.slice(-400);
      });
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      setStatus(retryCountRef.current > 0 ? "reconnecting" : "connecting");
      const handle = options.api.streamLogs({
        history: retryCountRef.current === 0 ? options.history ?? 120 : 0,
        level: options.level,
        fileId: options.fileId,
        query: options.query,
        onOpen: () => {
          setStatus("live");
          retryCountRef.current = 0;
        },
        onHistory: (entries) => {
          knownIdsRef.current.clear();
          setLogs([]);
          appendEntries(entries);
        },
        onLog: (entry) => {
          appendEntries([entry]);
        },
        onError: () => {
          if (disposed) {
            return;
          }
          handle.close();
          retryCountRef.current += 1;
          setStatus("reconnecting");
          const backoffMs = Math.min(8_000, 600 * 2 ** retryCountRef.current);
          retryTimerRef.current = window.setTimeout(connect, backoffMs);
        },
      });

      closeRef.current = () => handle.close();
    };

    connect();

    return () => {
      disposed = true;
      closeRef.current?.();
      closeRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [options.api, options.fileId, options.history, options.level, options.paused, options.query]);

  const clear = () => {
    knownIdsRef.current.clear();
    setLogs([]);
  };

  return {
    logs,
    status,
    clear,
  };
}
