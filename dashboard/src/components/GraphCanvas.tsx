import { Graph, GraphEvent, NodeEvent, type GraphData } from "@antv/g6";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

import { colorForPageType } from "../constants/pageTypeColors";
import type { DashboardGraphEdge, DashboardGraphNode, DashboardGraphOverview, DashboardPageSummary } from "../types/dashboard";
import { clamp } from "../utils/format";
import { computeConstellationLayout } from "../utils/layout";

interface GraphCanvasProps {
  graph: DashboardGraphOverview | null;
  selectedPageId: string | null;
  focusedPage: DashboardPageSummary | null;
  loading: boolean;
  searchQuery: string;
  searchResultCount: number;
  resetViewToken: number;
  onRefresh: () => void;
  onSelectPage: (pageId: string) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface DetachedStageNode extends DashboardPageSummary {
  nodeKey: string;
  degree: number;
  orphan: boolean;
  detached: true;
}

interface FocusCardAnchor {
  left: string;
  top: string;
}

const DEFAULT_SIZE: ViewportSize = {
  width: 1200,
  height: 720,
};

const GRAPH_PADDING = [116, 180, 132, 132];
const FOCUS_GHOST_PREFIX = "__focus__:";

function useViewportSize<T extends HTMLElement>(): [RefObject<T>, ViewportSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ViewportSize>(DEFAULT_SIZE);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: entry.contentRect.width || DEFAULT_SIZE.width,
        height: entry.contentRect.height || DEFAULT_SIZE.height,
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

function edgeId(edge: DashboardGraphEdge): string {
  return `${edge.source}->${edge.target}:${edge.edgeType}`;
}

function nodeRadius(node: Pick<DashboardGraphNode, "degree">): number {
  return Math.max(8, Math.min(18, 8 + node.degree * 1.35));
}

function shouldShowLabel(node: Pick<DashboardGraphNode, "degree" | "orphan">, nodeCount: number): boolean {
  return node.degree >= 4 || node.orphan || nodeCount <= 14;
}

function edgeStroke(edgeType: string): string {
  const normalized = edgeType.toLowerCase();
  if (normalized.includes("source")) {
    return "rgba(104, 168, 255, 0.28)";
  }
  if (normalized.includes("valid") || normalized.includes("support")) {
    return "rgba(88, 214, 167, 0.24)";
  }
  if (normalized.includes("counter") || normalized.includes("prereq")) {
    return "rgba(255, 122, 122, 0.24)";
  }
  return "rgba(214, 226, 255, 0.16)";
}

function edgeDash(edgeType: string): number[] | undefined {
  const normalized = edgeType.toLowerCase();
  if (normalized.includes("source")) {
    return [4, 8];
  }
  if (normalized.includes("counter")) {
    return [8, 8];
  }
  return undefined;
}

function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

function buildDetachedNode(focusedPage: DashboardPageSummary | null, graph: DashboardGraphOverview | null): DetachedStageNode | null {
  if (!focusedPage || !graph) {
    return null;
  }
  if (graph.nodes.some((node) => node.id === focusedPage.id)) {
    return null;
  }
  return {
    ...focusedPage,
    nodeKey: `${FOCUS_GHOST_PREFIX}${focusedPage.id}`,
    degree: 0,
    orphan: false,
    detached: true,
  };
}

function syncNormalizedPositions(nodes: DashboardGraphNode[], positionsRef: { current: Map<string, { x: number; y: number }> }): void {
  const nextLayout = computeConstellationLayout(nodes);
  const nextPositions = new Map<string, { x: number; y: number }>();

  for (const node of nodes) {
    nextPositions.set(node.nodeKey, positionsRef.current.get(node.nodeKey) ?? nextLayout.get(node.nodeKey) ?? { x: 0.5, y: 0.5 });
  }

  positionsRef.current = nextPositions;
}

function buildGraphData(options: {
  graph: DashboardGraphOverview;
  size: ViewportSize;
  detachedNode: DetachedStageNode | null;
  positionsRef: { current: Map<string, { x: number; y: number }> };
}): GraphData {
  const { graph, size, detachedNode, positionsRef } = options;

  const nodes = graph.nodes.map((node) => {
    const point = positionsRef.current.get(node.nodeKey) ?? { x: 0.5, y: 0.5 };
    const color = colorForPageType(node.pageType);
    const labelVisible = shouldShowLabel(node, graph.nodes.length);
    const labelPlacement: "left" | "right" = point.x > 0.68 ? "left" : "right";

    return {
      id: node.nodeKey,
      data: {
        pageId: node.id,
        pageType: node.pageType,
        title: node.title,
        status: node.status,
        nodeKey: node.nodeKey,
        detached: false,
      },
      style: {
        x: point.x * size.width,
        y: point.y * size.height,
        size: nodeRadius(node),
        fill: color,
        stroke: "#eff4ff",
        lineWidth: 1.1,
        fillOpacity: 0.9,
        shadowColor: color,
        shadowBlur: 18,
        shadowOpacity: 0.32,
        halo: true,
        haloStroke: color,
        haloLineWidth: Math.max(12, nodeRadius(node) * 1.85),
        haloStrokeOpacity: 0.18,
        label: labelVisible,
        labelText: labelVisible ? node.title : "",
        labelFill: "rgba(238, 243, 255, 0.76)",
        labelFontFamily: "JetBrains Mono",
        labelFontSize: labelVisible ? 11 : 10,
        labelPlacement,
        labelOffsetX: point.x > 0.68 ? -12 : 12,
        labelOffsetY: 1,
      },
    };
  });

  if (detachedNode) {
    const detachedColor = colorForPageType(detachedNode.pageType);
    nodes.push({
      id: detachedNode.nodeKey,
      data: {
        pageId: detachedNode.id,
        pageType: detachedNode.pageType,
        title: detachedNode.title,
        status: detachedNode.status,
        nodeKey: detachedNode.nodeKey,
        detached: true,
      },
      style: {
        x: size.width * 0.56,
        y: size.height * 0.52,
        size: 18,
        fill: detachedColor,
        stroke: "#f8fbff",
        lineWidth: 1.6,
        fillOpacity: 0.96,
        shadowColor: detachedColor,
        shadowBlur: 24,
        shadowOpacity: 0.48,
        halo: true,
        haloStroke: detachedColor,
        haloLineWidth: 32,
        haloStrokeOpacity: 0.38,
        label: true,
        labelText: detachedNode.title,
        labelFill: "rgba(246, 250, 255, 0.92)",
        labelFontFamily: "JetBrains Mono",
        labelFontSize: 11,
        labelPlacement: "right",
        labelOffsetX: 14,
        labelOffsetY: 2,
      },
    });
  }

  const edges = graph.edges.map((edge) => ({
    id: edgeId(edge),
    source: edge.source,
    target: edge.target,
    data: {
      edgeType: edge.edgeType,
    },
    style: {
      stroke: edgeStroke(edge.edgeType),
      strokeOpacity: 0.94,
      lineWidth: 1.2,
      lineDash: edgeDash(edge.edgeType),
      halo: true,
      haloStroke: edgeStroke(edge.edgeType),
      haloLineWidth: 12,
      haloStrokeOpacity: 0.12,
      endArrow: false,
    },
  }));

  return { nodes, edges };
}

function buildStateMap(options: {
  graph: DashboardGraphOverview;
  selectedNodeKey: string | null;
  hoveredNodeKey: string | null;
  detachedNodeKey: string | null;
}): Record<string, string[]> {
  const { graph, selectedNodeKey, hoveredNodeKey, detachedNodeKey } = options;
  const stateMap: Record<string, string[]> = {};

  if (selectedNodeKey) {
    const relatedNodes = new Set<string>([selectedNodeKey]);
    const relatedEdges = new Set<string>();
    for (const edge of graph.edges) {
      const id = edgeId(edge);
      if (edge.source === selectedNodeKey || edge.target === selectedNodeKey) {
        relatedNodes.add(edge.source);
        relatedNodes.add(edge.target);
        relatedEdges.add(id);
      }
      stateMap[id] = relatedEdges.has(id) ? ["highlight"] : ["inactive"];
    }

    for (const node of graph.nodes) {
      if (node.nodeKey === selectedNodeKey) {
        stateMap[node.nodeKey] = ["selected"];
      } else if (relatedNodes.has(node.nodeKey)) {
        stateMap[node.nodeKey] = ["highlight"];
      } else {
        stateMap[node.nodeKey] = ["inactive"];
      }
    }

    if (detachedNodeKey) {
      stateMap[detachedNodeKey] = detachedNodeKey === selectedNodeKey ? ["selected"] : ["inactive"];
    }

    return stateMap;
  }

  for (const edge of graph.edges) {
    stateMap[edgeId(edge)] = [];
  }

  for (const node of graph.nodes) {
    stateMap[node.nodeKey] = hoveredNodeKey && node.nodeKey === hoveredNodeKey ? ["hover"] : [];
  }

  if (detachedNodeKey) {
    stateMap[detachedNodeKey] = hoveredNodeKey && detachedNodeKey === hoveredNodeKey ? ["hover"] : [];
  }

  return stateMap;
}

async function focusSelectedNode(instance: Graph, nodeKey: string): Promise<void> {
  const currentZoom = instance.getZoom();
  if (currentZoom < 1.08) {
    await instance.zoomTo(1.12, { duration: 420, easing: "ease-in-out" }, instance.getCanvasCenter());
  }
  await instance.focusElement(nodeKey, { duration: 760, easing: "ease-in-out" });
}

export function GraphCanvas(props: GraphCanvasProps) {
  const [hostRef, size] = useViewportSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onSelectPageRef = useRef(props.onSelectPage);
  const focusedNodeKeyRef = useRef<string | null>(null);
  const selectedNodeKeyRef = useRef<string | null>(null);
  const hoveredNodeKeyRef = useRef<string | null>(null);
  const lastGraphSignatureRef = useRef<string | null>(null);
  const lastResetTokenRef = useRef<number>(props.resetViewToken);
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusAnchor, setFocusAnchor] = useState<FocusCardAnchor | null>(null);

  onSelectPageRef.current = props.onSelectPage;

  const detachedNode = useMemo(() => buildDetachedNode(props.focusedPage, props.graph), [props.focusedPage, props.graph]);
  const selectedNodeKey = useMemo(() => {
    if (!props.selectedPageId) {
      return null;
    }
    const graphNode = props.graph?.nodes.find((node) => node.id === props.selectedPageId);
    if (graphNode) {
      return graphNode.nodeKey;
    }
    if (detachedNode?.id === props.selectedPageId) {
      return detachedNode.nodeKey;
    }
    return null;
  }, [detachedNode, props.graph, props.selectedPageId]);

  selectedNodeKeyRef.current = selectedNodeKey;
  hoveredNodeKeyRef.current = hoveredNodeKey;

  const activeStageNode = useMemo(() => {
    const activeNodeKey = selectedNodeKey ?? hoveredNodeKey;
    if (!activeNodeKey) {
      return null;
    }
    if (detachedNode?.nodeKey === activeNodeKey) {
      return detachedNode;
    }
    return props.graph?.nodes.find((node) => node.nodeKey === activeNodeKey) ?? null;
  }, [detachedNode, hoveredNodeKey, props.graph, selectedNodeKey]);

  const legendTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of props.graph?.nodes ?? []) {
      counts.set(node.pageType, (counts.get(node.pageType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  }, [props.graph]);

  const focusedDetached = Boolean(detachedNode && props.selectedPageId === detachedNode.id);

  function syncViewportDetails() {
    const instance = graphRef.current;
    const activeNodeKey = selectedNodeKey ?? hoveredNodeKey;
    if (!instance) {
      return;
    }

    try {
      setZoom(instance.getZoom());
    } catch {
      return;
    }

    if (!activeNodeKey) {
      setFocusAnchor(null);
      return;
    }

    try {
      const data = instance.getNodeData(activeNodeKey) as {
        style?: {
          x?: number;
          y?: number;
        };
      };
      if (typeof data?.style?.x !== "number" || typeof data.style.y !== "number") {
        setFocusAnchor(null);
        return;
      }
      const [viewportX, viewportY] = instance.getViewportByCanvas([data.style.x, data.style.y]);
      setFocusAnchor({
        left: `${clamp((viewportX / size.width) * 100 - 4, 18, 72)}%`,
        top: `${clamp((viewportY / size.height) * 100 + 6, 20, 78)}%`,
      });
    } catch {
      setFocusAnchor(null);
    }
  }

  function fitOverview(animation: boolean) {
    const instance = graphRef.current;
    if (!instance) {
      return;
    }
    void instance.fitView({ when: "always" }, animation ? { duration: 660, easing: "ease-in-out" } : false).then(() => {
      syncViewportDetails();
    });
  }

  function updateDraggedNodePosition(nodeKey: string) {
    const instance = graphRef.current;
    if (!instance || !props.graph?.nodes.some((node) => node.nodeKey === nodeKey)) {
      return;
    }
    const data = instance.getNodeData(nodeKey) as {
      style?: {
        x?: number;
        y?: number;
      };
    };
    if (typeof data?.style?.x !== "number" || typeof data.style.y !== "number") {
      return;
    }
    positionsRef.current.set(nodeKey, {
      x: clamp(data.style.x / size.width, 0.08, 0.92),
      y: clamp(data.style.y / size.height, 0.1, 0.9),
    });
  }

  useEffect(() => {
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!props.graph || !canvasRef.current || !minimapRef.current || size.width < 40 || size.height < 40) {
      return;
    }

    syncNormalizedPositions(props.graph.nodes, positionsRef);

    const graphSignature = `${props.graph.nodes.map((node) => node.nodeKey).join("|")}::${props.graph.edges.length}::${Boolean(detachedNode)}`;
      const data = buildGraphData({
        graph: props.graph,
        size,
        detachedNode,
        positionsRef,
    });

    let cancelled = false;

    async function renderGraph() {
      let instance = graphRef.current;

      if (!instance) {
        instance = new Graph({
          container: canvasRef.current!,
          width: size.width,
          height: size.height,
          zoomRange: [0.48, 2.6],
          padding: GRAPH_PADDING,
          animation: true,
          data,
          node: {
            type: "circle",
            state: {
              selected: {
                stroke: "#f8fbff",
                lineWidth: 1.8,
                halo: true,
                haloLineWidth: 34,
                haloStrokeOpacity: 0.58,
              },
              highlight: {
                stroke: "#dce8ff",
                lineWidth: 1.4,
                halo: true,
                haloLineWidth: 22,
                haloStrokeOpacity: 0.28,
              },
              hover: {
                stroke: "#ffffff",
                lineWidth: 1.6,
                halo: true,
                haloLineWidth: 24,
                haloStrokeOpacity: 0.36,
              },
              inactive: {
                opacity: 0.18,
                labelFill: "rgba(238, 243, 255, 0.16)",
                haloStrokeOpacity: 0.04,
              },
            },
          },
          edge: {
            type: "quadratic",
            state: {
              highlight: {
                strokeOpacity: 1,
                lineWidth: 1.6,
                halo: true,
                haloLineWidth: 16,
                haloStrokeOpacity: 0.18,
              },
              inactive: {
                opacity: 0.08,
                strokeOpacity: 0.06,
              },
            },
          },
          behaviors: [
            { type: "drag-canvas", key: "drag-canvas" },
            { type: "zoom-canvas", key: "zoom-canvas", sensitivity: 1.08 },
            { type: "drag-element", key: "drag-element" },
            { type: "focus-element", key: "focus-element", animation: { duration: 760, easing: "ease-in-out" } },
          ],
          plugins: [
            {
              key: "stage-minimap",
              type: "minimap",
              container: minimapRef.current!,
              size: [164, 96],
              padding: 10,
              maskStyle: {
                border: "1px solid rgba(124, 182, 255, 0.46)",
                background: "rgba(104, 168, 255, 0.08)",
              },
            },
          ],
        });

        instance.on(NodeEvent.CLICK, (event) => {
          const targetId = String((event as { target?: { id?: string } }).target?.id ?? "");
          if (!targetId) {
            return;
          }
          const data = instance?.getNodeData(targetId) as {
            data?: {
              pageId?: string;
            };
          };
          const pageId = data?.data?.pageId;
          if (pageId) {
            onSelectPageRef.current(pageId);
          }
        });

        instance.on(NodeEvent.POINTER_OVER, (event) => {
          const nextKey = String((event as { target?: { id?: string } }).target?.id ?? "");
          hoveredNodeKeyRef.current = nextKey;
          setHoveredNodeKey(nextKey);
        });
        instance.on(NodeEvent.POINTER_OUT, () => {
          hoveredNodeKeyRef.current = null;
          setHoveredNodeKey(null);
        });
        instance.on(NodeEvent.DRAG_END, (event) => {
          const targetId = String((event as { target?: { id?: string } }).target?.id ?? "");
          if (!targetId) {
            return;
          }
          updateDraggedNodePosition(targetId);
          syncViewportDetails();
        });
        instance.on(GraphEvent.AFTER_TRANSFORM, () => {
          syncViewportDetails();
        });
        instance.on(GraphEvent.AFTER_RENDER, () => {
          syncViewportDetails();
        });

        graphRef.current = instance;
        await instance.render();
      } else {
        instance.resize(size.width, size.height);
        instance.setData(data);
        await instance.render();
      }

      if (cancelled) {
        return;
      }

      const nextStateMap = buildStateMap({
        graph: props.graph!,
        selectedNodeKey: selectedNodeKeyRef.current,
        hoveredNodeKey: hoveredNodeKeyRef.current,
        detachedNodeKey: detachedNode?.nodeKey ?? null,
      });
      await instance.setElementState(nextStateMap, false);

      if (selectedNodeKeyRef.current && focusedNodeKeyRef.current !== selectedNodeKeyRef.current) {
        focusedNodeKeyRef.current = selectedNodeKeyRef.current;
        await focusSelectedNode(instance, selectedNodeKeyRef.current);
      } else if (lastGraphSignatureRef.current !== graphSignature) {
        lastGraphSignatureRef.current = graphSignature;
        fitOverview(false);
      } else {
        syncViewportDetails();
      }
    }

    void renderGraph();

    return () => {
      cancelled = true;
    };
  }, [detachedNode, props.graph, size]);

  useEffect(() => {
    if (!props.graph || !graphRef.current?.rendered) {
      return;
    }
    const nextStateMap = buildStateMap({
      graph: props.graph!,
      selectedNodeKey,
      hoveredNodeKey,
      detachedNodeKey: detachedNode?.nodeKey ?? null,
    });
    void graphRef.current.setElementState(nextStateMap, false).then(() => {
      syncViewportDetails();
    });
  }, [detachedNode, hoveredNodeKey, props.graph, selectedNodeKey]);

  useEffect(() => {
    if (!selectedNodeKey || !graphRef.current?.rendered) {
      focusedNodeKeyRef.current = null;
      syncViewportDetails();
      return;
    }
    if (focusedNodeKeyRef.current === selectedNodeKey) {
      syncViewportDetails();
      return;
    }
    focusedNodeKeyRef.current = selectedNodeKey;
    void focusSelectedNode(graphRef.current, selectedNodeKey).then(() => {
      syncViewportDetails();
    });
  }, [selectedNodeKey]);

  useEffect(() => {
    if (lastResetTokenRef.current === props.resetViewToken) {
      return;
    }
    lastResetTokenRef.current = props.resetViewToken;
    fitOverview(true);
  }, [props.resetViewToken]);

  if (!props.graph) {
    return (
      <section className="graph-canvas graph-stage" ref={hostRef}>
        <div className="graph-canvas__placeholder graph-stage__placeholder">
          <strong>Loading constellation slice…</strong>
          <p>The daemon is assembling the current full-library overview.</p>
        </div>
      </section>
    );
  }

  const focusColor = activeStageNode ? colorForPageType(activeStageNode.pageType) : "var(--accent)";

  return (
    <section className="graph-canvas graph-stage" ref={hostRef}>
      <div className="graph-stage__canvas" ref={canvasRef} />

      <div className="graph-stage__copy">
        <span className="shell-eyebrow">Active observation</span>
        <h2>Whole-library overview</h2>
        <p>
          {props.graph.sampleStrategy?.limit ? `overview cap ${props.graph.sampleStrategy.limit} · ` : ""}
          {props.graph.truncated
            ? `${props.graph.visibleNodeCount}/${props.graph.totalNodes} nodes visible`
            : `${props.graph.visibleNodeCount} nodes visible`}
          {" · "}
          {props.graph.visibleEdgeCount} live edges
        </p>
        {focusedDetached && props.focusedPage ? (
          <p className="graph-stage__hint">
            {props.focusedPage.title} is outside the visible slice. A detached focus node is pinned so search can still hand off into detail.
          </p>
        ) : null}
      </div>

      <div className="graph-stage__tools">
        <div className="graph-stage__tool-group">
          <button type="button" onClick={() => fitOverview(true)}>
            fit
          </button>
          <button
            type="button"
            onClick={() => {
              const instance = graphRef.current;
              if (!instance) {
                return;
              }
              void instance.zoomTo(1, { duration: 320, easing: "ease-in-out" });
            }}
          >
            100%
          </button>
          <button
            type="button"
            onClick={() => {
              const instance = graphRef.current;
              if (!instance) {
                return;
              }
              void instance.zoomTo(1.4, { duration: 320, easing: "ease-in-out" }, instance.getCanvasCenter());
            }}
          >
            140%
          </button>
          <button
            type="button"
            disabled={!selectedNodeKey}
            onClick={() => {
              if (!selectedNodeKey || !graphRef.current) {
                return;
              }
              void focusSelectedNode(graphRef.current, selectedNodeKey);
            }}
          >
            focus
          </button>
        </div>
        <div className="graph-stage__tool-search">
          <span>{props.searchQuery.trim() ? props.searchQuery.trim() : "Search whole library from the top bar"}</span>
          <code>{props.searchQuery.trim() ? `${props.searchResultCount} hits` : zoomLabel(zoom)}</code>
        </div>
      </div>

      <div className="graph-stage__legend">
        <span className="shell-eyebrow">Classification</span>
        <div>
          {legendTypes.map(([pageType, count]) => (
            <span key={pageType}>
              <i style={{ background: colorForPageType(pageType) }} />
              {pageType}
              <strong>{count}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="graph-stage__minimap">
        <span>live map</span>
        <div className="graph-stage__minimap-host" ref={minimapRef} />
      </div>

      {activeStageNode && focusAnchor ? (
        <div
          className="graph-stage__focus-card"
          style={{
            ...focusAnchor,
            ["--focus-accent" as "--focus-accent"]: focusColor,
          }}
        >
          <strong>{activeStageNode.title}</strong>
          <span>{activeStageNode.nodeKey}</span>
        </div>
      ) : null}

      <div className="graph-stage__status">
        <span className="shell-eyebrow">Stage status</span>
        <div>
          <strong>{zoomLabel(zoom)}</strong>
          <small>{props.loading ? "refreshing overview…" : "drag-enabled · minimap live"}</small>
        </div>
        <button className="btn btn-primary" type="button" onClick={props.onRefresh} disabled={props.loading}>
          {props.loading ? "refreshing…" : "reload overview"}
        </button>
      </div>
    </section>
  );
}
