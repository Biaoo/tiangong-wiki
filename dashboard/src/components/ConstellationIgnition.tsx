import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { colorForPageType } from "../constants/pageTypeColors";
import type { DashboardGraphOverview, DashboardStatus } from "../types/dashboard";
import { clamp, formatNumber, formatRelativeTime } from "../utils/format";
import { computeConstellationLayout } from "../utils/layout";

export type IgnitionMode = "full" | "short" | "reduced";

interface ConstellationIgnitionProps {
  graph: DashboardGraphOverview | null;
  status: DashboardStatus | null;
  mode: IgnitionMode;
  onComplete: () => void;
}

const FRAGMENTS = [
  "/vault/physics/quantum/entanglement.md",
  "/vault/ops/queue/incident-72.md",
  "node:qk-9012",
  "node:br-042",
  "edge:references",
  "embedding:ready",
  "graph:overview(limit=120)",
  "source:synology-cache",
];

const FULL_PHASES: Array<{ phase: number; atMs: number }> = [
  { phase: 1, atMs: 800 },
  { phase: 2, atMs: 2800 },
  { phase: 3, atMs: 3600 },
  { phase: 4, atMs: 4400 },
  { phase: 5, atMs: 5800 },
];

const FULL_DURATION_MS = 7500;
const SHORT_DURATION_MS = 1000;
const REDUCED_DURATION_MS = 850;
const FULL_READY_TIMEOUT_MS = 1400;
const PREVIEW_WIDTH = 1600;
const PREVIEW_HEIGHT = 900;

function truncatePath(path: string | null | undefined): string {
  if (!path) {
    return "awaiting/page/source";
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 4) {
    return path;
  }
  return `…/${parts.slice(-4).join("/")}`;
}

function ignitionDuration(mode: IgnitionMode): number {
  if (mode === "full") {
    return FULL_DURATION_MS;
  }
  if (mode === "short") {
    return SHORT_DURATION_MS;
  }
  return REDUCED_DURATION_MS;
}

function buildFragments(graph: DashboardGraphOverview | null): string[] {
  if (!graph?.nodes.length) {
    return FRAGMENTS;
  }

  return graph.nodes
    .flatMap((node) => [
      node.filePath,
      `node:${node.nodeKey}`,
      `type:${node.pageType}`,
      `status:${node.status}`,
      node.orphan ? "graph:orphan-sample" : `degree:${node.degree}`,
    ])
    .filter(Boolean)
    .slice(0, 14);
}

export function ConstellationIgnition({ graph, status, mode, onComplete }: ConstellationIgnitionProps) {
  const [resolvedMode, setResolvedMode] = useState<IgnitionMode | null>(() => (mode === "full" ? null : mode));
  const [phase, setPhase] = useState(mode === "full" ? 0 : 5);
  const skipReadyRef = useRef(mode !== "full");

  const fragments = useMemo(() => buildFragments(graph), [graph]);
  const previewNodes = useMemo(() => graph?.nodes.slice(0, 48) ?? [], [graph]);
  const previewNodeMap = useMemo(() => new Map(previewNodes.map((node) => [node.nodeKey, node])), [previewNodes]);
  const previewNodeKeys = useMemo(() => new Set(previewNodes.map((node) => node.nodeKey)), [previewNodes]);
  const previewEdges = useMemo(
    () => graph?.edges.filter((edge) => previewNodeKeys.has(edge.source) && previewNodeKeys.has(edge.target)).slice(0, 120) ?? [],
    [graph, previewNodeKeys],
  );
  const previewLayout = useMemo(() => computeConstellationLayout(previewNodes), [previewNodes]);
  const focusNode = useMemo(
    () =>
      [...previewNodes].sort((left, right) => {
        if (right.degree !== left.degree) {
          return right.degree - left.degree;
        }
        return left.title.localeCompare(right.title);
      })[0] ?? null,
    [previewNodes],
  );
  const focusPoint = useMemo(() => (focusNode ? previewLayout.get(focusNode.nodeKey) ?? null : null), [focusNode, previewLayout]);
  const focusRelations = useMemo(() => {
    if (!focusNode) {
      return [];
    }
    return previewEdges
      .filter((edge) => edge.source === focusNode.nodeKey || edge.target === focusNode.nodeKey)
      .map((edge) => {
        const relatedKey = edge.source === focusNode.nodeKey ? edge.target : edge.source;
        const relatedNode = previewNodeMap.get(relatedKey);
        if (!relatedNode) {
          return null;
        }
        return {
          title: relatedNode.title,
          pageType: relatedNode.pageType,
          direction: edge.source === focusNode.nodeKey ? "outgoing" : "incoming",
          edgeType: edge.edgeType,
        };
      })
      .filter((entry): entry is { title: string; pageType: string; direction: "outgoing" | "incoming"; edgeType: string } => Boolean(entry))
      .slice(0, 4);
  }, [focusNode, previewEdges, previewNodeMap]);
  const legendTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of previewNodes) {
      counts.set(node.pageType, (counts.get(node.pageType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);
  }, [previewNodes]);
  const nodeCount = graph?.totalNodes ?? 0;
  const edgeCount = graph?.totalEdges ?? 0;
  const visibleNodeCount = graph?.visibleNodeCount ?? 0;
  const queuePending = status?.queue.pending ?? 0;
  const daemonOnline = status?.daemon.running ?? false;
  const focusAccent = focusNode ? colorForPageType(focusNode.pageType) : "var(--accent)";
  const focusCardStyle = focusPoint
    ? {
        left: `${clamp(focusPoint.x * 100 - 4, 18, 72)}%`,
        top: `${clamp(focusPoint.y * 100 + 8, 22, 80)}%`,
        ["--focus-accent" as "--focus-accent"]: focusAccent,
      }
    : undefined;
  const overviewLabel = graph?.truncated
    ? `live overview slice ready · ${visibleNodeCount}/${nodeCount} nodes visible`
    : `live overview ready · ${visibleNodeCount} nodes visible`;
  const activeMode = resolvedMode ?? mode;
  const shellStateLabel = daemonOnline ? "running" : "offline";
  const shellTaskLabel = status?.daemon.currentTask ?? "overview handoff";
  const shellFreshness = formatRelativeTime(status?.generatedAt ?? graph?.generatedAt ?? null);

  useEffect(() => {
    if (mode !== "full") {
      setResolvedMode(mode);
      return;
    }

    if (resolvedMode !== null) {
      return;
    }

    if (graph?.nodes.length) {
      setResolvedMode("full");
      return;
    }

    const fallbackTimer = window.setTimeout(() => {
      setResolvedMode("short");
    }, FULL_READY_TIMEOUT_MS);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [graph?.nodes.length, mode, resolvedMode]);

  useEffect(() => {
    if (resolvedMode === null) {
      setPhase(0);
      return;
    }

    const duration = ignitionDuration(resolvedMode);
    const timers: number[] = [];
    setPhase(resolvedMode === "full" ? 0 : 5);
    skipReadyRef.current = resolvedMode !== "full";

    if (resolvedMode === "full") {
      timers.push(
        window.setTimeout(() => {
          skipReadyRef.current = true;
        }, 180),
      );
      for (const mark of FULL_PHASES) {
        timers.push(window.setTimeout(() => setPhase(mark.phase), mark.atMs));
      }
    }

    timers.push(window.setTimeout(() => onComplete(), duration));

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Escape" || event.key === "Enter") && skipReadyRef.current) {
        onComplete();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onComplete, resolvedMode]);

  return (
    <div
      className={`ignition-overlay ignition-overlay--phase-${phase} ignition-overlay--${activeMode}`}
      onClick={() => {
        if (skipReadyRef.current) {
          onComplete();
        }
      }}
      role="presentation"
    >
      <div className="ignition-overlay__aurora ignition-overlay__aurora--primary" />
      <div className="ignition-overlay__aurora ignition-overlay__aurora--secondary" />
      <div className="ignition-overlay__grid" />
      <div className="ignition-overlay__noise" />
      <div className="ignition-overlay__vignette" />
      <button
        className="ignition-skip"
        onClick={(event) => {
          event.stopPropagation();
          if (skipReadyRef.current) {
            onComplete();
          }
        }}
        type="button"
      >
        Enter / Skip
      </button>

      <div className="ignition-shell" aria-hidden="true">
        <header className="ignition-shell__topbar">
          <div className="ignition-shell__brand">
            <span className="ignition-shell__eyebrow">Stellar Intel</span>
            <strong>Knowledge Constellation</strong>
            <p>local graph observatory · desktop-only control deck</p>
          </div>
          <div className="ignition-shell__status">
            <div className={`ignition-shell__status-chip ${daemonOnline ? "is-live" : "is-offline"}`}>
              <span className="ignition-shell__status-dot" />
              <span>{shellStateLabel}</span>
              <code>{shellTaskLabel}</code>
            </div>
            <div className="ignition-shell__metrics">
              <div>
                <span>graph</span>
                <strong>{formatNumber(nodeCount)}</strong>
              </div>
              <div>
                <span>visible</span>
                <strong>{formatNumber(visibleNodeCount)}</strong>
              </div>
              <div>
                <span>queue</span>
                <strong>{formatNumber(queuePending)}</strong>
              </div>
            </div>
            <div className="ignition-shell__freshness">refreshed {shellFreshness}</div>
          </div>
        </header>

        <aside className="ignition-shell__rail">
          <button type="button">◎</button>
          <button type="button">◫</button>
          <button type="button">⋰</button>
          <button type="button">⌁</button>
          <button type="button">◌</button>
        </aside>

        <section className="ignition-shell__stage">
          <div className={`ignition-shell__stage-copy ${phase >= 5 ? "is-compact" : ""}`}>
            <span className="ignition-shell__eyebrow">Active observation</span>
            <h2>{phase >= 5 ? "Whole-library overview" : "Whole-library graph ignition"}</h2>
            <p>
              {graph?.sampleStrategy?.limit ? `overview cap ${graph.sampleStrategy.limit} · ` : ""}
              {overviewLabel}
            </p>
          </div>

          <div className="ignition-shell__tools">
            <div className="ignition-shell__tool-group">
              <button type="button">bubble</button>
              <button type="button">filter</button>
              <button type="button">sweep</button>
            </div>
            <div className="ignition-shell__tool-search">
              <span>locate node…</span>
              <code>graph</code>
            </div>
          </div>

          {previewNodes.length > 0 ? (
            <svg
              className={`ignition-preview ignition-preview--phase-${phase}`}
              viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="ignition-node-halo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
              </defs>
              {focusPoint ? (
                <g className="ignition-preview__orbits">
                  <ellipse
                    cx={focusPoint.x * PREVIEW_WIDTH}
                    cy={focusPoint.y * PREVIEW_HEIGHT}
                    rx={PREVIEW_WIDTH * 0.22}
                    ry={PREVIEW_HEIGHT * 0.14}
                  />
                  <ellipse
                    cx={focusPoint.x * PREVIEW_WIDTH}
                    cy={focusPoint.y * PREVIEW_HEIGHT}
                    rx={PREVIEW_WIDTH * 0.31}
                    ry={PREVIEW_HEIGHT * 0.22}
                    transform={`rotate(-18 ${focusPoint.x * PREVIEW_WIDTH} ${focusPoint.y * PREVIEW_HEIGHT})`}
                  />
                </g>
              ) : null}
              <g className="ignition-preview__edges">
                {previewEdges.map((edge, index) => {
                  const source = previewLayout.get(edge.source);
                  const target = previewLayout.get(edge.target);
                  if (!source || !target) {
                    return null;
                  }
                  const sourceX = source.x * PREVIEW_WIDTH;
                  const sourceY = source.y * PREVIEW_HEIGHT;
                  const targetX = target.x * PREVIEW_WIDTH;
                  const targetY = target.y * PREVIEW_HEIGHT;
                  const controlX = (sourceX + targetX) / 2;
                  const controlY =
                    (sourceY + targetY) / 2 +
                    (index % 2 === 0 ? -1 : 1) * clamp(Math.abs(sourceX - targetX) * 0.08, 24, 120);
                  return (
                    <path
                      key={`${edge.source}-${edge.target}-${edge.edgeType}`}
                      d={`M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`}
                    />
                  );
                })}
              </g>
              <g className="ignition-preview__nodes">
                {previewNodes.map((node) => {
                  const point = previewLayout.get(node.nodeKey);
                  if (!point) {
                    return null;
                  }
                  const radius = Math.max(5, Math.min(17, 5 + node.degree * 0.9));
                  const isFocus = focusNode?.id === node.id;
                  const color = colorForPageType(node.pageType);
                  return (
                    <g key={node.id}>
                      {isFocus ? (
                        <>
                          <circle
                            className="ignition-preview__focus-halo"
                            cx={point.x * PREVIEW_WIDTH}
                            cy={point.y * PREVIEW_HEIGHT}
                            r={radius * 3.8}
                            fill="url(#ignition-node-halo)"
                          />
                          <circle
                            className="ignition-preview__focus-ring"
                            cx={point.x * PREVIEW_WIDTH}
                            cy={point.y * PREVIEW_HEIGHT}
                            r={radius * 2.2}
                          />
                        </>
                      ) : null}
                      <circle
                        className={`ignition-preview__node ${isFocus ? "is-focus" : ""}`}
                        cx={point.x * PREVIEW_WIDTH}
                        cy={point.y * PREVIEW_HEIGHT}
                        r={radius}
                        fill={color}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
          ) : (
            <div className="ignition-preview ignition-preview--empty">
              <span>awaiting live graph slice</span>
            </div>
          )}

          {focusNode && focusPoint ? (
            <div className="ignition-focus-card" style={focusCardStyle}>
              <strong>{focusNode.title}</strong>
              <span>{focusNode.nodeKey}</span>
            </div>
          ) : null}

          <div className="ignition-shell__legend">
            <span className="ignition-shell__eyebrow">Classification</span>
            <div>
              {legendTypes.length > 0
                ? legendTypes.map(([pageType, count]) => (
                    <span key={pageType}>
                      <i style={{ background: colorForPageType(pageType) }} />
                      {pageType}
                      <strong>{count}</strong>
                    </span>
                  ))
                : ["concept", "source-summary", "bridge"].map((pageType) => (
                    <span key={pageType}>
                      <i style={{ background: colorForPageType(pageType) }} />
                      {pageType}
                    </span>
                  ))}
            </div>
          </div>

          <div className="ignition-shell__minimap">
            <span>live map</span>
            <div>
              <b />
            </div>
          </div>
        </section>

        <aside className="ignition-shell__detail">
          <div className="ignition-shell__detail-badges">
            <span style={{ ["--badge-accent" as "--badge-accent"]: focusAccent }}>
              {focusNode?.pageType ?? "overview"}
            </span>
            <span>{focusNode?.status ?? "indexing"}</span>
          </div>
          <h3>{focusNode?.title ?? "Awaiting focal node"}</h3>
          <p className="ignition-shell__detail-path">{truncatePath(focusNode?.filePath)}</p>
          <div className="ignition-shell__detail-stats">
            <div>
              <span>degree</span>
              <strong>{focusNode?.degree ?? 0}</strong>
            </div>
            <div>
              <span>updated</span>
              <strong>{formatRelativeTime(focusNode?.updatedAt ?? null)}</strong>
            </div>
          </div>
          <div className="ignition-shell__detail-block">
            <span className="ignition-shell__eyebrow">Connected threads</span>
            <ul>
              {focusRelations.length > 0 ? (
                focusRelations.map((relation) => (
                  <li key={`${relation.direction}-${relation.edgeType}-${relation.title}`}>
                    <i style={{ background: colorForPageType(relation.pageType) }} />
                    <div>
                      <strong>{relation.title}</strong>
                      <span>
                        {relation.direction} · {relation.edgeType}
                      </span>
                    </div>
                  </li>
                ))
              ) : (
                <li className="is-empty">
                  <div>
                    <strong>semantic links incoming</strong>
                    <span>waiting for graph relations to settle</span>
                  </div>
                </li>
              )}
            </ul>
          </div>
        </aside>

        <div className="ignition-shell__dock">
          <div className="ignition-shell__dock-tabs">
            <span>overview</span>
            <span>system</span>
            <span>queue</span>
            <span>vault</span>
            <span>lint</span>
          </div>
          <div className="ignition-shell__dock-query">
            <span>search the live universe…</span>
            <code>{queuePending} pending</code>
          </div>
        </div>
      </div>

      {phase < 3 && <div className="ignition-heartbeat" />}

      {resolvedMode === null ? (
        <div className="ignition-statusline">
          <strong>assembling live overview</strong>
          <span>waiting for the first graph slice</span>
        </div>
      ) : null}

      {phase === 1 && (
        <div className="ignition-fragments">
          {fragments.map((fragment, index) => (
            <span
              key={fragment}
              className="ignition-fragment"
              style={{
                ["--fragment-delay" as "--fragment-delay"]: `${(index % 6) * 120}ms`,
                ["--fragment-angle" as "--fragment-angle"]: `${(index * 29) % 360}deg`,
              }}
            >
              {fragment}
            </span>
          ))}
        </div>
      )}

      {phase === 2 && <div className="ignition-implosion" />}
      {phase === 3 && <div className="ignition-flash" />}

      {phase >= 4 && (
        <div className="ignition-emergence">
          <div className="ignition-emergence__metrics">
            <div className="ignition-emergence__card">
              <strong>{formatNumber(nodeCount)}</strong>
              <span>library nodes</span>
            </div>
            <div className="ignition-emergence__card">
              <strong>{formatNumber(edgeCount)}</strong>
              <span>indexed relations</span>
            </div>
            <div className="ignition-emergence__card">
              <strong>{formatNumber(queuePending)}</strong>
              <span>queue pending</span>
            </div>
          </div>
          <div className="ignition-emergence__scan">
            <div />
            <p>
              semantic lock acquired
              {graph?.sampleStrategy?.limit ? ` · overview cap ${graph.sampleStrategy.limit}` : ""}
            </p>
          </div>
        </div>
      )}

      {phase >= 5 && (
        <div className="ignition-reveal">
          <p>whole-library overview ready</p>
          <h1>Knowledge Constellation</h1>
          <span>{overviewLabel}</span>
        </div>
      )}
    </div>
  );
}
