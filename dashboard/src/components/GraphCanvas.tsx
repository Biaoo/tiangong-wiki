import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

import { colorForPageType } from "../constants/pageTypeColors";
import type { DashboardGraphOverview, DashboardPageSummary } from "../types/dashboard";
import { computeConstellationLayout } from "../utils/layout";

interface GraphCanvasProps {
  graph: DashboardGraphOverview | null;
  selectedPageId: string | null;
  focusedPage: DashboardPageSummary | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectPage: (pageId: string) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_SIZE: ViewportSize = {
  width: 1200,
  height: 720,
};

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

export function GraphCanvas(props: GraphCanvasProps) {
  const [hostRef, size] = useViewportSize<HTMLDivElement>();

  if (!props.graph) {
    return (
      <section className="graph-canvas" ref={hostRef}>
        <div className="graph-canvas__placeholder">
          <strong>Loading constellation slice…</strong>
          <p>The daemon is assembling the current overview graph.</p>
        </div>
      </section>
    );
  }

  const graph = props.graph;
  const layout = computeConstellationLayout(graph.nodes);
  const width = Math.max(640, size.width);
  const height = Math.max(420, size.height);
  const focusedDetached = Boolean(
    props.focusedPage &&
      !graph.nodes.some((node) => node.id === props.focusedPage?.id),
  );

  return (
    <section className="graph-canvas" ref={hostRef}>
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Knowledge graph overview">
        <g opacity={0.92}>
          {graph.edges.map((edge) => {
            const source = layout.get(edge.source);
            const target = layout.get(edge.target);
            if (!source || !target) {
              return null;
            }

            return (
              <line
                key={`${edge.source}-${edge.target}-${edge.edgeType}`}
                className="graph-edge"
                x1={source.x * width}
                y1={source.y * height}
                x2={target.x * width}
                y2={target.y * height}
                strokeWidth="1"
              />
            );
          })}
        </g>

        <g>
          {graph.nodes.map((node) => {
            const point = layout.get(node.nodeKey);
            if (!point) {
              return null;
            }

            const isSelected = props.selectedPageId === node.id;
            const radius = Math.max(5, Math.min(16, 6 + node.degree * 1.25));
            const fill = colorForPageType(node.pageType);
            const labelVisible = isSelected || node.degree >= 4 || node.orphan || graph.nodes.length <= 12;
            const labelOnLeft = point.x > 0.68;

            return (
              <g
                key={node.id}
                className={`graph-node ${isSelected ? "is-selected" : ""}`}
                transform={`translate(${point.x * width}, ${point.y * height})`}
                onClick={() => props.onSelectPage(node.id)}
              >
                <circle r={radius * 1.8} fill={fill} opacity={0.12} />
                <circle r={radius} fill={fill} opacity={isSelected ? 0.95 : 0.78} />
                <circle r={radius * 0.44} fill="#f8fbff" opacity={0.92} />
                {labelVisible ? (
                  <text
                    className="graph-label"
                    x={labelOnLeft ? -radius - 7 : radius + 7}
                    y={4}
                    textAnchor={labelOnLeft ? "end" : "start"}
                  >
                    {node.title}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {graph.nodes.map((node) => {
        const point = layout.get(node.nodeKey);
        if (!point) {
          return null;
        }
        return (
          <button
            key={`${node.id}-hotspot`}
            type="button"
            className="graph-hotspot"
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
            }}
            aria-label={node.title}
            onClick={() => props.onSelectPage(node.id)}
          />
        );
      })}

      <div className="graph-overlay">
        <h2>Full-library overview</h2>
        <p>
          Total nodes <strong>{graph.totalNodes}</strong> · Visible slice <strong>{graph.visibleNodeCount}</strong> ·
          Edges <strong>{graph.visibleEdgeCount}</strong>
        </p>
        <p className="graph-overlay__hint">
          {graph.truncated
            ? "Capped overview active. Search still spans the full library."
            : "Entire current graph slice is visible."}
        </p>
        {focusedDetached && props.focusedPage ? (
          <p className="graph-overlay__hint">
            Focused page <strong>{props.focusedPage.title}</strong> is outside the current slice and remains available through the detail panel.
          </p>
        ) : null}
        <button className="btn btn-primary" type="button" onClick={props.onRefresh} disabled={props.loading}>
          {props.loading ? "refreshing…" : "reload overview"}
        </button>
      </div>
    </section>
  );
}
