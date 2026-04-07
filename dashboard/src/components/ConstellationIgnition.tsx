import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { colorForPageType } from "../constants/pageTypeColors";
import type { DashboardGraphOverview } from "../types/dashboard";
import { computeConstellationLayout } from "../utils/layout";

export type IgnitionMode = "full" | "short" | "reduced";

interface ConstellationIgnitionProps {
  graph: DashboardGraphOverview | null;
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
      node.orphan ? "graph:orphan-sample" : `degree:${node.degree}`,
    ])
    .filter(Boolean)
    .slice(0, 14);
}

export function ConstellationIgnition({ graph, mode, onComplete }: ConstellationIgnitionProps) {
  const [resolvedMode, setResolvedMode] = useState<IgnitionMode | null>(() => (mode === "full" ? null : mode));
  const [phase, setPhase] = useState(mode === "full" ? 0 : 5);
  const skipReadyRef = useRef(mode !== "full");

  const fragments = useMemo(() => buildFragments(graph), [graph]);
  const previewNodes = useMemo(() => graph?.nodes.slice(0, 48) ?? [], [graph]);
  const previewNodeKeys = useMemo(() => new Set(previewNodes.map((node) => node.nodeKey)), [previewNodes]);
  const previewEdges = useMemo(
    () => graph?.edges.filter((edge) => previewNodeKeys.has(edge.source) && previewNodeKeys.has(edge.target)).slice(0, 120) ?? [],
    [graph, previewNodeKeys],
  );
  const previewLayout = useMemo(() => computeConstellationLayout(previewNodes), [previewNodes]);
  const nodeCount = graph?.totalNodes ?? 0;
  const edgeCount = graph?.totalEdges ?? 0;
  const visibleNodeCount = graph?.visibleNodeCount ?? 0;
  const overviewLabel = graph?.truncated
    ? `live overview slice ready · ${visibleNodeCount}/${nodeCount} nodes visible`
    : `live overview ready · ${visibleNodeCount} nodes visible`;
  const activeMode = resolvedMode ?? mode;

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

  const modeLabel =
    activeMode === "full"
      ? "Constellation Ignition / full sequence"
      : activeMode === "short"
        ? "Constellation Ignition / returning-user short reveal"
        : "Constellation Ignition / reduced motion reveal";

  return (
    <div
      className="ignition-overlay"
      onClick={() => {
        if (skipReadyRef.current) {
          onComplete();
        }
      }}
      role="presentation"
    >
      <div className="ignition-overlay__noise" />
      {phase >= 3 && previewNodes.length > 0 ? (
        <svg
          className={`ignition-preview ignition-preview--phase-${phase}`}
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          aria-hidden="true"
        >
          <g className="ignition-preview__edges">
            {previewEdges.map((edge) => {
              const source = previewLayout.get(edge.source);
              const target = previewLayout.get(edge.target);
              if (!source || !target) {
                return null;
              }
              return (
                <line
                  key={`${edge.source}-${edge.target}-${edge.edgeType}`}
                  x1={source.x * PREVIEW_WIDTH}
                  y1={source.y * PREVIEW_HEIGHT}
                  x2={target.x * PREVIEW_WIDTH}
                  y2={target.y * PREVIEW_HEIGHT}
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
              const radius = Math.max(4, Math.min(15, 5 + node.degree * 0.8));
              return (
                <circle
                  key={node.id}
                  cx={point.x * PREVIEW_WIDTH}
                  cy={point.y * PREVIEW_HEIGHT}
                  r={radius}
                  fill={colorForPageType(node.pageType)}
                />
              );
            })}
          </g>
        </svg>
      ) : null}
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
        Skip
      </button>

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

      {phase === 4 && (
        <div className="ignition-semantic">
          <div className="ignition-counter">
            <strong>{nodeCount || "..."}</strong>
            <span>Library Nodes</span>
          </div>
          <div className="ignition-counter">
            <strong>{edgeCount || "..."}</strong>
            <span>Relations Indexed</span>
          </div>
          <div className="ignition-scanline">
            <div />
            <p>
              semantic coherence sweep
              {graph?.sampleStrategy?.limit ? ` · overview cap ${graph.sampleStrategy.limit}` : ""}
            </p>
          </div>
        </div>
      )}

      {phase >= 5 && (
        <div className="ignition-reveal">
          <h1>Knowledge Constellation</h1>
          <p>{modeLabel}</p>
          <p>{overviewLabel}</p>
        </div>
      )}
    </div>
  );
}
