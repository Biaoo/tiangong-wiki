import { randomUUID } from "node:crypto";
import type http from "node:http";

import type { WriteActorMetadata } from "../types/page.js";
import { AppError } from "../utils/errors.js";

const ASCII_ID_PATTERN = /^[A-Za-z0-9._:@/-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function validateAsciiField(field: "actorId" | "actorType" | "requestId", value: string): string {
  if (!ASCII_ID_PATTERN.test(value)) {
    throw new AppError(`${field} must be a stable ASCII identifier, got ${value}`, "config", {
      code: "invalid_request",
      field,
    });
  }
  return value;
}

function newRequestId(): string {
  return `req:${randomUUID()}`;
}

function getBodyActor(body: Record<string, unknown>): Record<string, unknown> | null {
  return isPlainObject(body.actor) ? body.actor : null;
}

export function buildCliWriteActor(env: NodeJS.ProcessEnv = process.env): WriteActorMetadata {
  return {
    actorId: validateAsciiField("actorId", env.WIKI_ACTOR_ID?.trim() || "user:local-cli"),
    actorType: validateAsciiField("actorType", env.WIKI_ACTOR_TYPE?.trim() || "user"),
    requestId: validateAsciiField("requestId", env.WIKI_REQUEST_ID?.trim() || newRequestId()),
  };
}

export function buildSystemWriteActor(label = "daemon"): WriteActorMetadata {
  return {
    actorId: validateAsciiField("actorId", `system:${label}`),
    actorType: validateAsciiField("actorType", "system"),
    requestId: validateAsciiField("requestId", newRequestId()),
  };
}

export function resolveWriteActor(
  request: http.IncomingMessage,
  body: Record<string, unknown>,
  fallback: WriteActorMetadata,
): WriteActorMetadata {
  const bodyActor = getBodyActor(body);
  const actorId =
    normalizeOptionalString(request.headers["x-wiki-actor-id"]) ??
    normalizeOptionalString(bodyActor?.actorId) ??
    fallback.actorId;
  const actorType =
    normalizeOptionalString(request.headers["x-wiki-actor-type"]) ??
    normalizeOptionalString(bodyActor?.actorType) ??
    fallback.actorType;
  const requestId =
    normalizeOptionalString(request.headers["x-request-id"]) ??
    normalizeOptionalString(bodyActor?.requestId) ??
    fallback.requestId ??
    newRequestId();

  return {
    actorId: validateAsciiField("actorId", actorId),
    actorType: validateAsciiField("actorType", actorType),
    requestId: validateAsciiField("requestId", requestId),
  };
}
