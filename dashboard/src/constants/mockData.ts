import type {
  DashboardGraphOverview,
  DashboardGraphSearchResponse,
  DashboardLintIssuesResponse,
  DashboardLintSummary,
  DashboardLogEntry,
  DashboardPageDetailResponse,
  DashboardPageSourceResponse,
  DashboardQueueItemDetail,
  DashboardQueueListResponse,
  DashboardQueueSummary,
  DashboardStatus,
  DashboardVaultFileDetail,
  DashboardVaultFilesResponse,
  DashboardVaultSummary,
} from "../types/dashboard";

const nowIso = new Date().toISOString();

const MOCK_NODES = [
  {
    id: "physics/quantum-entanglement.md",
    nodeKey: "qe-001",
    title: "Quantum Entanglement",
    pageType: "concept",
    status: "active",
    filePath: "physics/quantum-entanglement.md",
    tags: ["physics", "network", "foundational"],
    updatedAt: nowIso,
    degree: 6,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "methods/retrieval-pipeline.md",
    nodeKey: "rp-207",
    title: "Retrieval Pipeline",
    pageType: "method",
    status: "active",
    filePath: "methods/retrieval-pipeline.md",
    tags: ["pipeline", "index"],
    updatedAt: nowIso,
    degree: 5,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "lessons/sync-failure-postmortem.md",
    nodeKey: "ls-119",
    title: "Sync Failure Postmortem",
    pageType: "lesson",
    status: "active",
    filePath: "lessons/sync-failure-postmortem.md",
    tags: ["sync", "incident"],
    updatedAt: nowIso,
    degree: 3,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "research/semantic-drifts.md",
    nodeKey: "rn-302",
    title: "Semantic Drifts in Long-Lived Vaults",
    pageType: "research-note",
    status: "draft",
    filePath: "research/semantic-drifts.md",
    tags: ["semantic", "drift"],
    updatedAt: nowIso,
    degree: 2,
    orphan: false,
    embeddingStatus: "pending",
    sourceType: "pdf",
  },
  {
    id: "bridges/vault-to-wiki-bridge.md",
    nodeKey: "br-042",
    title: "Vault to Wiki Bridge",
    pageType: "bridge",
    status: "active",
    filePath: "bridges/vault-to-wiki-bridge.md",
    tags: ["integration", "bridge"],
    updatedAt: nowIso,
    degree: 5,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "person/leslie-lamport.md",
    nodeKey: "pr-881",
    title: "Leslie Lamport",
    pageType: "person",
    status: "active",
    filePath: "person/leslie-lamport.md",
    tags: ["distributed-systems"],
    updatedAt: nowIso,
    degree: 1,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "faq/dashboard-operation.md",
    nodeKey: "fq-501",
    title: "Dashboard Operation FAQ",
    pageType: "faq",
    status: "active",
    filePath: "faq/dashboard-operation.md",
    tags: ["faq"],
    updatedAt: nowIso,
    degree: 2,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "source/obsidian-export-summary.md",
    nodeKey: "ss-090",
    title: "Obsidian Export Summary",
    pageType: "source-summary",
    status: "active",
    filePath: "source/obsidian-export-summary.md",
    tags: ["source", "obsidian"],
    updatedAt: nowIso,
    degree: 3,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "resume/runtime-architecture.md",
    nodeKey: "re-655",
    title: "Runtime Architecture Resume",
    pageType: "resume",
    status: "active",
    filePath: "resume/runtime-architecture.md",
    tags: ["overview", "architecture"],
    updatedAt: nowIso,
    degree: 1,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
  {
    id: "myths/polling-is-free.md",
    nodeKey: "mc-773",
    title: "Polling Is Free",
    pageType: "misconception",
    status: "active",
    filePath: "myths/polling-is-free.md",
    tags: ["misconception", "operations"],
    updatedAt: nowIso,
    degree: 2,
    orphan: false,
    embeddingStatus: "ready",
    sourceType: "md",
  },
];

const MOCK_EDGES = [
  { source: "qe-001", target: "rp-207", edgeType: "references", sourcePage: "physics/quantum-entanglement.md" },
  { source: "qe-001", target: "br-042", edgeType: "supports", sourcePage: "physics/quantum-entanglement.md" },
  { source: "rp-207", target: "ls-119", edgeType: "validated-by", sourcePage: "methods/retrieval-pipeline.md" },
  { source: "rp-207", target: "rn-302", edgeType: "extends", sourcePage: "methods/retrieval-pipeline.md" },
  { source: "br-042", target: "ss-090", edgeType: "source", sourcePage: "bridges/vault-to-wiki-bridge.md" },
  { source: "br-042", target: "fq-501", edgeType: "documents", sourcePage: "bridges/vault-to-wiki-bridge.md" },
  { source: "ss-090", target: "mc-773", edgeType: "counterexample", sourcePage: "source/obsidian-export-summary.md" },
  { source: "ss-090", target: "re-655", edgeType: "summarizes", sourcePage: "source/obsidian-export-summary.md" },
  { source: "pr-881", target: "re-655", edgeType: "inspired", sourcePage: "person/leslie-lamport.md" },
  { source: "fq-501", target: "ls-119", edgeType: "references", sourcePage: "faq/dashboard-operation.md" },
];

export function mockStatus(): DashboardStatus {
  return {
    daemon: {
      running: true,
      pid: 14820,
      host: "127.0.0.1",
      port: 4747,
      lastSyncAt: nowIso,
      nextSyncAt: null,
      lastResult: "ok",
      syncIntervalSeconds: 600,
      launchMode: "manual",
      currentTask: "idle",
      startedAt: nowIso,
      uptimeMs: 4_320_000,
    },
    queue: {
      pending: 4,
      processing: 1,
      done: 176,
      skipped: 12,
      error: 2,
    },
    runtime: {
      vaultSource: "synology",
      wikiPath: "/wiki",
      vaultPath: "/vault",
      dbPath: "/runtime/wiki.db",
    },
    doctor: {
      ok: false,
      summary: {
        ok: 5,
        warn: 1,
        error: 0,
      },
      checks: [
        { id: "sqlite", severity: "ok", summary: "Runtime DB reachable." },
        { id: "vault-cache", severity: "warn", summary: "1 stale cached file." },
      ],
      recommendations: ["Refresh cache metadata before the next full sync."],
    },
    generatedAt: nowIso,
    lastSyncAt: nowIso,
  };
}

export function mockGraphOverview(): DashboardGraphOverview {
  return {
    nodes: MOCK_NODES,
    edges: MOCK_EDGES,
    totalNodes: 268,
    visibleNodeCount: MOCK_NODES.length,
    totalEdges: 1_944,
    visibleEdgeCount: MOCK_EDGES.length,
    truncated: true,
    sampleStrategy: {
      limit: 120,
      priorities: ["degree", "recency", "pageType coverage", "orphan sampling"],
    },
    generatedAt: nowIso,
  };
}

export function mockSearch(query: string): DashboardGraphSearchResponse {
  const normalized = query.trim().toLowerCase();
  const results = normalized
    ? MOCK_NODES.filter((node) => `${node.title} ${node.filePath} ${node.tags.join(" ")}`.toLowerCase().includes(normalized)).map(
        (node) => ({
          id: node.id,
          title: node.title,
          pageType: node.pageType,
          status: node.status,
          filePath: node.filePath,
          tags: node.tags,
          updatedAt: node.updatedAt,
          summaryText: `Match in ${node.title}.`,
          searchKind: "fallback",
          nodeId: node.nodeKey,
        }),
      )
    : [];

  return {
    query,
    mode: normalized ? "fallback" : "empty",
    resultCount: results.length,
    results,
    generatedAt: nowIso,
  };
}

const MOCK_QUEUE_ITEMS = [
  {
    fileId: "vault://docs/quantum-entanglement.pdf",
    fileName: "quantum-entanglement.pdf",
    filePath: "/vault/docs/quantum-entanglement.pdf",
    sourceType: "pdf",
    status: "processing",
    decision: "extract-and-summarize",
    timing: { startedAt: nowIso, processingDurationMs: 12_830 },
    resultPageId: null,
  },
  {
    fileId: "vault://research/semantic-drifts.docx",
    fileName: "semantic-drifts.docx",
    filePath: "/vault/research/semantic-drifts.docx",
    sourceType: "docx",
    status: "error",
    decision: "retry-required",
    errorMessage: "OCR engine timeout.",
    timing: { lastErrorAt: nowIso, processingDurationMs: 43_102 },
    resultPageId: null,
  },
  {
    fileId: "vault://daily/runtime-notes-2026-04-08.md",
    fileName: "runtime-notes-2026-04-08.md",
    filePath: "/vault/daily/runtime-notes-2026-04-08.md",
    sourceType: "md",
    status: "done",
    decision: "append-to-existing",
    timing: { processedAt: nowIso, processingDurationMs: 1_004 },
    resultPageId: "resume/runtime-architecture.md",
  },
  {
    fileId: "vault://ops/logbook/incident-72.md",
    fileName: "incident-72.md",
    filePath: "/vault/ops/logbook/incident-72.md",
    sourceType: "md",
    status: "pending",
    decision: "pending",
    timing: { queuedAt: nowIso },
    resultPageId: null,
  },
];

export function mockQueueSummary(): DashboardQueueSummary {
  return {
    counts: {
      pending: 4,
      processing: 1,
      done: 176,
      skipped: 12,
      error: 2,
      total: 194,
    },
    processing: MOCK_QUEUE_ITEMS.filter((item) => item.status === "processing"),
    errors: MOCK_QUEUE_ITEMS.filter((item) => item.status === "error"),
    recentDone: MOCK_QUEUE_ITEMS.filter((item) => item.status === "done"),
    generatedAt: nowIso,
  };
}

export function mockQueueItems(): DashboardQueueListResponse {
  return {
    total: MOCK_QUEUE_ITEMS.length,
    items: MOCK_QUEUE_ITEMS,
    generatedAt: nowIso,
  };
}

export function mockQueueItemDetail(fileId: string): DashboardQueueItemDetail {
  const item = MOCK_QUEUE_ITEMS.find((entry) => entry.fileId === fileId) ?? MOCK_QUEUE_ITEMS[0];
  return {
    item,
    artifacts: {
      artifactId: "mock-artifact-bundle",
      prompt: {
        exists: true,
        rawText: "Mock workflow prompt payload.",
        preview: "Analyze the vault item, extract stable knowledge, and attach source metadata.",
      },
      result: {
        exists: true,
        rawText: "{\"status\":\"done\",\"decision\":\"apply\"}",
        parsed: { status: "done", decision: "apply" },
        parseError: null,
      },
    },
    linkedPages: [
      {
        id: "resume/runtime-architecture.md",
        title: "Runtime Architecture Resume",
        pageType: "resume",
        status: "active",
        filePath: "resume/runtime-architecture.md",
        tags: ["architecture"],
        updatedAt: nowIso,
      },
    ],
    generatedAt: nowIso,
  };
}

export function mockPageDetail(pageId: string): DashboardPageDetailResponse {
  const page =
    MOCK_NODES.find((node) => node.id === pageId || node.nodeKey === pageId) ??
    MOCK_NODES.find((node) => node.id === "physics/quantum-entanglement.md") ??
    MOCK_NODES[0];
  return {
    page: {
      id: page.id,
      title: page.title,
      pageType: page.pageType,
      status: page.status,
      filePath: page.filePath,
      tags: page.tags,
      updatedAt: page.updatedAt,
      nodeKey: page.nodeKey,
      summaryText:
        "This page captures the operational concept and explains how linked pages reinforce the current retrieval strategy.",
      embeddingStatus: page.embeddingStatus,
      markdownPreview: [
        "# " + page.title,
        "",
        "## Summary",
        "Knowledge graph node preview generated from dashboard fallback data.",
        "",
        "## Signals",
        "- relation density is healthy",
        "- source mapping available",
        "- no major lint violations",
      ].join("\n"),
      frontmatter: {
        type: page.pageType,
        status: page.status,
        tags: page.tags,
      },
      unregisteredFields: [],
      pagePath: `/wiki/${page.filePath}`,
    },
    relations: MOCK_EDGES.filter((edge) => edge.source === page.nodeKey || edge.target === page.nodeKey).map((edge) => {
      const outgoing = edge.source === page.nodeKey;
      const related = MOCK_NODES.find((candidate) => candidate.nodeKey === (outgoing ? edge.target : edge.source));
      return {
        direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
        edgeType: edge.edgeType,
        ...(outgoing
          ? {
              source: {
                id: page.id,
                title: page.title,
                pageType: page.pageType,
                status: page.status,
                filePath: page.filePath,
                tags: page.tags,
                updatedAt: page.updatedAt,
              },
              target: related
                ? {
                    id: related.id,
                    title: related.title,
                    pageType: related.pageType,
                    status: related.status,
                    filePath: related.filePath,
                    tags: related.tags,
                    updatedAt: related.updatedAt,
                  }
                : null,
              rawTarget: related ? undefined : edge.target,
            }
          : {
              source: related
                ? {
                    id: related.id,
                    title: related.title,
                    pageType: related.pageType,
                    status: related.status,
                    filePath: related.filePath,
                    tags: related.tags,
                    updatedAt: related.updatedAt,
                  }
                : null,
              target: {
                id: page.id,
                title: page.title,
                pageType: page.pageType,
                status: page.status,
                filePath: page.filePath,
                tags: page.tags,
                updatedAt: page.updatedAt,
              },
              rawSource: related ? undefined : edge.source,
            }),
      };
    }),
    relationCounts: {
      outgoing: MOCK_EDGES.filter((edge) => edge.source === page.nodeKey).length,
      incoming: MOCK_EDGES.filter((edge) => edge.target === page.nodeKey).length,
    },
    generatedAt: nowIso,
  };
}

export function mockPageSource(pageId: string): DashboardPageSourceResponse {
  const detail = mockPageDetail(pageId);
  return {
    pageSource: {
      pageId: detail.page.id,
      pagePath: detail.page.pagePath,
      rawMarkdown: detail.page.markdownPreview,
      frontmatter: detail.page.frontmatter,
    },
    vaultSource: {
      fileId: `vault://${detail.page.filePath}`,
      fileName: detail.page.filePath.split("/").at(-1) ?? detail.page.filePath,
      fileExt: detail.page.filePath.split(".").at(-1) ?? "md",
      sourceType: "md",
      fileSize: 16_384,
      remotePath: `/vault/${detail.page.filePath}`,
      previewAvailable: true,
      preview: "Vault preview snippet ready for local open action.",
      previewError: null,
    },
    generatedAt: nowIso,
  };
}

export function mockVaultSummary(): DashboardVaultSummary {
  return {
    totalFiles: 3_812,
    totalBytes: 2_846_230_912,
    coverage: {
      pending: 24,
      processing: 1,
      done: 3_715,
      skipped: 58,
      error: 14,
      notQueued: 124,
    },
    bySourceType: {
      md: { count: 2_402, totalBytes: 301_222_400 },
      pdf: { count: 770, totalBytes: 1_904_339_100 },
      docx: { count: 640, totalBytes: 640_669_412 },
    },
    cacheStatus: {
      local: 3_221,
      remote: 388,
      stale: 203,
    },
    mappedPages: 2_419,
    generatedAt: nowIso,
  };
}

export function mockVaultFiles(): DashboardVaultFilesResponse {
  return {
    total: 4,
    items: [
      {
        fileId: "vault://docs/quantum-entanglement.pdf",
        fileName: "quantum-entanglement.pdf",
        fileExt: "pdf",
        sourceType: "pdf",
        fileSize: 9_431_441,
        filePath: "/vault/docs/quantum-entanglement.pdf",
        indexedAt: nowIso,
        queueStatus: "processing",
        queueItem: MOCK_QUEUE_ITEMS[0],
        generatedPageCount: 1,
        cacheStatus: "local",
        localPath: "/cache/docs/quantum-entanglement.pdf",
      },
      {
        fileId: "vault://research/semantic-drifts.docx",
        fileName: "semantic-drifts.docx",
        fileExt: "docx",
        sourceType: "docx",
        fileSize: 2_331_002,
        filePath: "/vault/research/semantic-drifts.docx",
        indexedAt: nowIso,
        queueStatus: "error",
        queueItem: MOCK_QUEUE_ITEMS[1],
        generatedPageCount: 0,
        cacheStatus: "stale",
        localPath: "/cache/research/semantic-drifts.docx",
      },
      {
        fileId: "vault://daily/runtime-notes-2026-04-08.md",
        fileName: "runtime-notes-2026-04-08.md",
        fileExt: "md",
        sourceType: "md",
        fileSize: 18_122,
        filePath: "/vault/daily/runtime-notes-2026-04-08.md",
        indexedAt: nowIso,
        queueStatus: "done",
        queueItem: MOCK_QUEUE_ITEMS[2],
        generatedPageCount: 1,
        cacheStatus: "local",
        localPath: "/cache/daily/runtime-notes-2026-04-08.md",
      },
      {
        fileId: "vault://ops/logbook/incident-72.md",
        fileName: "incident-72.md",
        fileExt: "md",
        sourceType: "md",
        fileSize: 5_432,
        filePath: "/vault/ops/logbook/incident-72.md",
        indexedAt: nowIso,
        queueStatus: "pending",
        queueItem: MOCK_QUEUE_ITEMS[3],
        generatedPageCount: 0,
        cacheStatus: "remote",
      },
    ],
    generatedAt: nowIso,
  };
}

export function mockVaultFileDetail(fileId: string): DashboardVaultFileDetail {
  const file = mockVaultFiles().items.find((entry) => entry.fileId === fileId) ?? mockVaultFiles().items[0];
  return {
    file: {
      ...file,
      previewAvailable: true,
      preview: `Preview for ${file.fileName}\n\nThis is a fallback local cache excerpt used when the dashboard API is unavailable.`,
      previewError: null,
      metadataPath: "/cache/metadata/mock.json",
    },
    queueItem: file.queueItem,
    relatedPages: [
      {
        id: "resume/runtime-architecture.md",
        title: "Runtime Architecture Resume",
        pageType: "resume",
        status: "active",
        filePath: "resume/runtime-architecture.md",
        tags: ["architecture"],
        updatedAt: nowIso,
      },
    ],
    generatedAt: nowIso,
  };
}

export function mockLintSummary(): DashboardLintSummary {
  return {
    counts: {
      error: 3,
      warning: 11,
      info: 27,
      total: 41,
    },
    topRules: [
      { rule: "link-target-exists", count: 9 },
      { rule: "source-ref-valid", count: 7 },
      { rule: "frontmatter-shape", count: 5 },
    ],
    topPages: [
      { pageId: "bridges/vault-to-wiki-bridge.md", count: 6 },
      { pageId: "research/semantic-drifts.md", count: 5 },
      { pageId: "faq/dashboard-operation.md", count: 4 },
    ],
    generatedAt: nowIso,
  };
}

export function mockLintIssues(): DashboardLintIssuesResponse {
  return {
    total: 4,
    groupBy: "flat",
    items: [
      {
        level: "error",
        pageId: "research/semantic-drifts.md",
        check: "source-ref-valid",
        message: "Referenced vault file no longer exists in remote share.",
        pageTitle: "Semantic Drifts in Long-Lived Vaults",
        pageType: "research-note",
        nodeId: "rn-302",
      },
      {
        level: "warning",
        pageId: "bridges/vault-to-wiki-bridge.md",
        check: "frontmatter-shape",
        message: "Field `confidence` should be number in range [0, 1].",
        pageTitle: "Vault to Wiki Bridge",
        pageType: "bridge",
        nodeId: "br-042",
      },
      {
        level: "warning",
        pageId: "faq/dashboard-operation.md",
        check: "link-target-exists",
        message: "Dangling relation to removed page `ops/deprecated-lint.md`.",
        pageTitle: "Dashboard Operation FAQ",
        pageType: "faq",
        nodeId: "fq-501",
      },
      {
        level: "info",
        pageId: "resume/runtime-architecture.md",
        check: "tag-convention",
        message: "Tag `architecture` can be normalized to `system-architecture`.",
        pageTitle: "Runtime Architecture Resume",
        pageType: "resume",
        nodeId: "re-655",
      },
    ],
    generatedAt: nowIso,
  };
}

export function mockLogs(): DashboardLogEntry[] {
  return [
    {
      id: 1,
      timestamp: nowIso,
      level: "info",
      message: "Daemon heartbeat accepted.",
      line: `[${nowIso}] Daemon heartbeat accepted.`,
      fileId: null,
    },
    {
      id: 2,
      timestamp: nowIso,
      level: "info",
      message: "Queue item vault://daily/runtime-notes-2026-04-08.md processed in 1004ms.",
      line: `[${nowIso}] queue item vault://daily/runtime-notes-2026-04-08.md processed in 1004ms.`,
      fileId: "vault://daily/runtime-notes-2026-04-08.md",
    },
    {
      id: 3,
      timestamp: nowIso,
      level: "info",
      message: "Cache stale for file vault://research/semantic-drifts.docx.",
      line: `[${nowIso}] Cache stale for file vault://research/semantic-drifts.docx.`,
      fileId: "vault://research/semantic-drifts.docx",
    },
    {
      id: 4,
      timestamp: nowIso,
      level: "error",
      message: "Retry required for vault://research/semantic-drifts.docx: OCR engine timeout.",
      line: `[${nowIso}] Retry required for vault://research/semantic-drifts.docx: OCR engine timeout.`,
      fileId: "vault://research/semantic-drifts.docx",
    },
  ];
}
