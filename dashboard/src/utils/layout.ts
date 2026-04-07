import type { DashboardGraphNode } from "../types/dashboard";

export interface NodePosition {
  x: number;
  y: number;
}

function hashToFloat(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

export function computeConstellationLayout(nodes: DashboardGraphNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) {
    return positions;
  }

  const grouped = new Map<string, DashboardGraphNode[]>();
  for (const node of nodes) {
    const key = String(node.pageType || "unknown");
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(node);
  }

  const groups = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  const clusterRadius = 0.36;

  groups.forEach(([groupKey, groupNodes], groupIndex) => {
    const angle = (Math.PI * 2 * groupIndex) / groups.length;
    const anchorX = 0.5 + Math.cos(angle) * clusterRadius;
    const anchorY = 0.5 + Math.sin(angle) * clusterRadius;

    groupNodes
      .slice()
      .sort((left, right) => right.degree - left.degree || left.title.localeCompare(right.title))
      .forEach((node, nodeIndex) => {
        const ring = Math.floor(Math.sqrt(nodeIndex));
        const inRingIndex = nodeIndex - ring * ring;
        const ringCount = Math.max(1, ring * 2 + 1);
        const ringAngle = (Math.PI * 2 * inRingIndex) / ringCount + hashToFloat(node.nodeKey) * 0.55;
        const ringDistance = 0.03 + ring * 0.037 + hashToFloat(groupKey + node.nodeKey) * 0.015;

        positions.set(node.nodeKey, {
          x: anchorX + Math.cos(ringAngle) * ringDistance,
          y: anchorY + Math.sin(ringAngle) * ringDistance,
        });
      });
  });

  return positions;
}
