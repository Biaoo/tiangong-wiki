import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { RuntimePaths, WriteActorMetadata } from "../types/page.js";
import { ensureDirSync } from "../utils/fs.js";
import { toOffsetIso } from "../utils/time.js";

export interface DaemonAuditEvent {
  eventId: string;
  timestamp: string;
  requestId: string;
  actorId: string;
  actorType: string;
  operation: string;
  resourceId: string | null;
  status:
    | "write_applied"
    | "sync_failed"
    | "git_commit_succeeded"
    | "git_commit_failed"
    | "git_commit_skipped";
  revisionBefore: string | null;
  revisionAfter: string | null;
  commitHash: string | null;
  details: Record<string, unknown> | null;
}

export function appendAuditEvent(
  paths: RuntimePaths,
  actor: WriteActorMetadata,
  input: Omit<DaemonAuditEvent, "eventId" | "timestamp" | "requestId" | "actorId" | "actorType">,
): DaemonAuditEvent {
  ensureDirSync(path.dirname(paths.auditLogPath));
  const event: DaemonAuditEvent = {
    eventId: randomUUID(),
    timestamp: toOffsetIso(),
    requestId: actor.requestId,
    actorId: actor.actorId,
    actorType: actor.actorType,
    ...input,
  };
  appendFileSync(paths.auditLogPath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
