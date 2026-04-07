const ONE_KIB = 1024;
const ONE_MIB = ONE_KIB * 1024;
const ONE_GIB = ONE_MIB * 1024;

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value >= ONE_GIB) {
    return `${(value / ONE_GIB).toFixed(2)} GiB`;
  }
  if (value >= ONE_MIB) {
    return `${(value / ONE_MIB).toFixed(1)} MiB`;
  }
  if (value >= ONE_KIB) {
    return `${(value / ONE_KIB).toFixed(1)} KiB`;
  }
  return `${Math.round(value)} B`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "n/a";
  }
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return "n/a";
  }

  const deltaMs = Date.now() - timestamp;
  const deltaSec = Math.floor(deltaMs / 1000);
  if (deltaSec < 15) {
    return "just now";
  }
  if (deltaSec < 60) {
    return `${deltaSec}s ago`;
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)}m ago`;
  }
  if (deltaSec < 86_400) {
    return `${Math.floor(deltaSec / 3600)}h ago`;
  }
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "n/a";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDuration(valueMs: number | null | undefined): string {
  if (!Number.isFinite(valueMs) || (valueMs ?? 0) < 0) {
    return "n/a";
  }

  const totalMs = Math.round(valueMs ?? 0);
  if (totalMs < 1_000) {
    return `${totalMs}ms`;
  }

  const totalSeconds = Math.floor(totalMs / 1_000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}
