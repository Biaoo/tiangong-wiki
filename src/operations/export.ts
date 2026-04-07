import { getMeta } from "../core/db.js";
import { openRuntimeDb } from "../core/runtime.js";
import { readAllPages } from "../core/sync.js";
import { AppError } from "../utils/errors.js";
import { toOffsetIso } from "../utils/time.js";

export interface ExportIndexOptions {
  groupBy?: string;
}

function renderGroup(
  title: string,
  pages: ReturnType<typeof readAllPages>,
): string {
  if (pages.length === 0) {
    return `## ${title}\n`;
  }

  return [
    `## ${title} (${pages.length})`,
    "",
    ...pages.map((page) => {
      const tagText = page.tags.length > 0 ? `, tags: ${page.tags.join(", ")}` : "";
      return `- [${page.title}](${page.id}) — ${page.status}${tagText}`;
    }),
    "",
  ].join("\n");
}

export function exportIndexContent(
  env: NodeJS.ProcessEnv = process.env,
  options: ExportIndexOptions = {},
): {
  generatedAt: string;
  pageCount: number;
  edgeCount: number;
  groupBy: string;
  lastSyncAt: string | null;
  content: string;
} {
  const { db } = openRuntimeDb(env);
  try {
    const pages = readAllPages(db);
    const groupBy = options.groupBy ?? "pageType";
    if (!["pageType", "tags"].includes(groupBy)) {
      throw new AppError(`Unsupported --group-by value: ${groupBy}`, "config");
    }

    const edgeCountRow = db.prepare("SELECT COUNT(*) AS count FROM edges").get() as { count: number };
    const groups = new Map<string, typeof pages>();
    if (groupBy === "pageType") {
      for (const page of pages) {
        const group = groups.get(page.pageType) ?? [];
        group.push(page);
        groups.set(page.pageType, group);
      }
    } else {
      for (const page of pages) {
        const tags = page.tags.length > 0 ? page.tags : ["untagged"];
        for (const tag of tags) {
          const group = groups.get(tag) ?? [];
          group.push(page);
          groups.set(tag, group);
        }
      }
    }

    const generatedAt = toOffsetIso();
    return {
      generatedAt,
      pageCount: pages.length,
      edgeCount: edgeCountRow.count,
      groupBy,
      lastSyncAt: getMeta(db, "last_sync_at"),
      content: [
        "# Wiki Index",
        "",
        `Generated: ${generatedAt} | ${pages.length} pages | ${edgeCountRow.count} edges`,
        "",
        ...[...groups.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([title, groupPages]) => renderGroup(title, groupPages)),
      ].join("\n"),
    };
  } finally {
    db.close();
  }
}

export function exportGraphContent(
  env: NodeJS.ProcessEnv = process.env,
): {
  generatedAt: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
} {
  const { db } = openRuntimeDb(env);
  try {
    const nodes = db
      .prepare(
        `
          SELECT
            id,
            node_id AS nodeId,
            title,
            page_type AS pageType,
            file_path AS filePath
          FROM pages
          WHERE node_id IS NOT NULL
          ORDER BY node_id
        `,
      )
      .all() as Array<Record<string, unknown>>;
    const edges = db
      .prepare(
        `
          SELECT
            source,
            target,
            edge_type AS edgeType,
            source_page AS sourcePage,
            metadata
          FROM edges
          ORDER BY edge_type, source, target
        `,
      )
      .all() as Array<Record<string, unknown>>;
    const normalizedEdges = edges.map((edge) => ({
      ...edge,
      metadata: edge.metadata ? JSON.parse(String(edge.metadata)) : {},
    }));

    return {
      generatedAt: toOffsetIso(),
      nodes,
      edges: normalizedEdges,
    };
  } finally {
    db.close();
  }
}
