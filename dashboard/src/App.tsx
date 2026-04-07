import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { DashboardApiClient, DashboardApiError } from "./api/client";
import { BottomDock } from "./components/BottomDock";
import { ConstellationIgnition, type IgnitionMode } from "./components/ConstellationIgnition";
import { DetailPanel } from "./components/DetailPanel";
import { EnvironmentGate } from "./components/EnvironmentGate";
import { GraphCanvas } from "./components/GraphCanvas";
import { LeftRail } from "./components/LeftRail";
import { TopBar } from "./components/TopBar";
import {
  mockGraphOverview,
  mockLintIssues,
  mockLintSummary,
  mockPageDetail,
  mockPageSource,
  mockLogs,
  mockQueueItemDetail,
  mockQueueItems,
  mockQueueSummary,
  mockSearch,
  mockStatus,
  mockVaultFileDetail,
  mockVaultFiles,
  mockVaultSummary,
} from "./constants/mockData";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useLogStream } from "./hooks/useLogStream";
import { useReducedMotion } from "./hooks/useReducedMotion";
import type {
  DashboardGraphOverview,
  DashboardLintIssue,
  DashboardGraphSearchResponse,
  DashboardLintIssuesResponse,
  DashboardLintSummary,
  DashboardPageDetailResponse,
  DashboardPageSourceResponse,
  DashboardQueueItemDetail,
  DashboardQueueListResponse,
  DashboardQueueSummary,
  DashboardStatus,
  DashboardTab,
  DashboardUrlState,
  DashboardVaultFileDetail,
  DashboardVaultFilesResponse,
  DashboardVaultSummary,
} from "./types/dashboard";
import { readUrlState, writeUrlState } from "./utils/urlState";

const INTRO_STORAGE_KEY = "wiki-dashboard-intro-complete";

function toErrorMessage(error: unknown): string {
  if (error instanceof DashboardApiError && error.bodyText) {
    try {
      const payload = JSON.parse(error.bodyText) as { error?: string };
      if (payload.error) {
        return payload.error;
      }
    } catch {
      return error.bodyText;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function initialUrlState(): DashboardUrlState {
  return readUrlState();
}

function normalizeLower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function filterMockQueueList(options: {
  status?: string;
  sourceType?: string;
  query?: string;
}): DashboardQueueListResponse {
  const sourceType = normalizeLower(options.sourceType);
  const query = normalizeLower(options.query);
  const items = mockQueueItems().items.filter((item) => {
    const matchesStatus = options.status ? item.status === options.status : true;
    const matchesSource = sourceType ? normalizeLower(item.sourceType) === sourceType : true;
    const matchesQuery = query
      ? [
          item.fileId,
          item.fileName,
          item.filePath,
          item.status,
          item.decision,
          item.errorMessage,
          item.resultPageId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true;
    return matchesStatus && matchesSource && matchesQuery;
  });

  return {
    total: items.length,
    items,
    generatedAt: new Date().toISOString(),
  };
}

function filterMockVaultFiles(options: {
  sourceType?: string;
  queueStatus?: string;
  query?: string;
}): DashboardVaultFilesResponse {
  const sourceType = normalizeLower(options.sourceType);
  const queueStatus = normalizeLower(options.queueStatus);
  const query = normalizeLower(options.query);
  const items = mockVaultFiles().items.filter((item) => {
    const matchesSource = sourceType ? normalizeLower(item.sourceType ?? item.fileExt ?? "") === sourceType : true;
    const matchesQueueStatus = queueStatus ? normalizeLower(item.queueStatus) === queueStatus : true;
    const matchesQuery = query
      ? [item.fileId, item.fileName, item.filePath, item.queueStatus, item.cacheStatus]
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true;
    return matchesSource && matchesQueueStatus && matchesQuery;
  });

  return {
    total: items.length,
    items,
    generatedAt: new Date().toISOString(),
  };
}

function buildMockLintGroups(
  items: DashboardLintIssue[],
  groupBy: "page" | "rule",
): NonNullable<DashboardLintIssuesResponse["groups"]> {
  const grouped = new Map<string, DashboardLintIssue[]>();
  for (const item of items) {
    const key = groupBy === "page" ? item.pageId : item.check;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(item);
  }

  return [...grouped.entries()]
    .map(([key, groupItems]) => ({
      key,
      count: groupItems.length,
      levelCounts: groupItems.reduce<Record<string, number>>((accumulator, item) => {
        accumulator[item.level] = (accumulator[item.level] ?? 0) + 1;
        return accumulator;
      }, {}),
      pageTitle: groupBy === "page" ? groupItems[0]?.pageTitle ?? null : null,
      pageType: groupBy === "page" ? groupItems[0]?.pageType ?? null : null,
      items: groupItems,
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function filterMockLintIssues(options: {
  level?: string;
  groupBy?: "flat" | "page" | "rule";
  rule?: string;
}): DashboardLintIssuesResponse {
  const level = normalizeLower(options.level);
  const rule = normalizeLower(options.rule);
  const groupBy = options.groupBy ?? "flat";
  const items = (mockLintIssues().items ?? []).filter((item) => {
    const matchesLevel = level ? item.level === level : true;
    const matchesRule = rule ? normalizeLower(item.check).includes(rule) : true;
    return matchesLevel && matchesRule;
  });

  if (groupBy === "flat") {
    return {
      total: items.length,
      groupBy,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    total: items.length,
    groupBy,
    groups: buildMockLintGroups(items, groupBy),
    generatedAt: new Date().toISOString(),
  };
}

export function App() {
  const apiRef = useRef<DashboardApiClient | null>(null);
  const introReplayTimerRef = useRef<number | null>(null);
  if (!apiRef.current) {
    apiRef.current = new DashboardApiClient();
  }
  const api = apiRef.current;
  const reducedMotion = useReducedMotion();

  const [urlState, setUrlState] = useState<DashboardUrlState>(initialUrlState);
  const [usingFallback, setUsingFallback] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [introReplayCount, setIntroReplayCount] = useState(0);
  const [bootLoading, setBootLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pageDetailLoading, setPageDetailLoading] = useState(false);
  const [queueDetailLoading, setQueueDetailLoading] = useState(false);
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [graph, setGraph] = useState<DashboardGraphOverview | null>(null);
  const [queueSummary, setQueueSummary] = useState<DashboardQueueSummary | null>(null);
  const [queueItems, setQueueItems] = useState<DashboardQueueListResponse | null>(null);
  const [queueDetail, setQueueDetail] = useState<DashboardQueueItemDetail | null>(null);
  const [vaultSummary, setVaultSummary] = useState<DashboardVaultSummary | null>(null);
  const [vaultFiles, setVaultFiles] = useState<DashboardVaultFilesResponse | null>(null);
  const [vaultDetail, setVaultDetail] = useState<DashboardVaultFileDetail | null>(null);
  const [lintSummary, setLintSummary] = useState<DashboardLintSummary | null>(null);
  const [lintIssues, setLintIssues] = useState<DashboardLintIssuesResponse | null>(null);
  const [pageDetail, setPageDetail] = useState<DashboardPageDetailResponse | null>(null);
  const [pageSource, setPageSource] = useState<DashboardPageSourceResponse | null>(null);
  const [searchPayload, setSearchPayload] = useState<DashboardGraphSearchResponse | null>(null);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockHeightPercent, setDockHeightPercent] = useState<40 | 55 | 70>(40);
  const [selectedQueueFileId, setSelectedQueueFileId] = useState<string | null>(null);
  const [selectedVaultFileId, setSelectedVaultFileId] = useState<string | null>(null);
  const [queueStatusFilter, setQueueStatusFilter] = useState("");
  const [queueSourceTypeFilter, setQueueSourceTypeFilter] = useState("");
  const [queueQueryFilter, setQueueQueryFilter] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState("");
  const [logFileIdFilter, setLogFileIdFilter] = useState("");
  const [logQueryFilter, setLogQueryFilter] = useState("");
  const [vaultSourceTypeFilter, setVaultSourceTypeFilter] = useState("");
  const [vaultQueueStatusFilter, setVaultQueueStatusFilter] = useState("");
  const [vaultQueryFilter, setVaultQueryFilter] = useState("");
  const [lintLevelFilter, setLintLevelFilter] = useState("");
  const [lintGroupByFilter, setLintGroupByFilter] = useState<"flat" | "page" | "rule">("flat");
  const [lintRuleFilter, setLintRuleFilter] = useState("");
  const [sourceActionPending, setSourceActionPending] = useState(false);
  const [sourceActionMessage, setSourceActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const debouncedSearchQuery = useDebouncedValue(urlState.query, 220);
  const debouncedQueueQuery = useDebouncedValue(queueQueryFilter, 220);
  const debouncedLogQuery = useDebouncedValue(logQueryFilter, 220);
  const debouncedVaultQuery = useDebouncedValue(vaultQueryFilter, 220);
  const debouncedLintRule = useDebouncedValue(lintRuleFilter, 220);
  const selectedSearchResults = searchPayload?.results ?? [];

  const { logs, status: logStreamStatus } = useLogStream({
    api,
    history: 180,
    level: logLevelFilter === "info" || logLevelFilter === "error" ? logLevelFilter : undefined,
    fileId: logFileIdFilter.trim() || undefined,
    query: debouncedLogQuery.trim() || undefined,
  });
  const displayLogs = usingFallback && logs.length === 0 ? mockLogs() : logs;

  useEffect(() => {
    const onPopState = () => {
      setUrlState(readUrlState());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (introReplayTimerRef.current !== null) {
        window.clearTimeout(introReplayTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    writeUrlState(urlState);
  }, [urlState]);

  const introMode = useMemo<IgnitionMode>(() => {
    if (reducedMotion) {
      return "reduced";
    }
    const visited = window.sessionStorage.getItem(INTRO_STORAGE_KEY) === "true";
    return visited && introReplayCount === 0 ? "short" : "full";
  }, [introReplayCount, reducedMotion]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setBootLoading(true);
      setActionError(null);

      const [statusResult, graphResult, queueSummaryResult, vaultSummaryResult, lintSummaryResult] = await Promise.allSettled([
        api.getStatus(),
        api.getGraphOverview(),
        api.getQueueSummary(),
        api.getVaultSummary(),
        api.getLintSummary(),
      ]);

      if (cancelled) {
        return;
      }

      const hasFallback =
        statusResult.status === "rejected" ||
        graphResult.status === "rejected" ||
        queueSummaryResult.status === "rejected" ||
        vaultSummaryResult.status === "rejected" ||
        lintSummaryResult.status === "rejected";
      setUsingFallback(hasFallback);

      setStatus(statusResult.status === "fulfilled" ? statusResult.value : mockStatus());
      setGraph(graphResult.status === "fulfilled" ? graphResult.value : mockGraphOverview());
      setQueueSummary(queueSummaryResult.status === "fulfilled" ? queueSummaryResult.value : mockQueueSummary());
      setVaultSummary(vaultSummaryResult.status === "fulfilled" ? vaultSummaryResult.value : mockVaultSummary());
      setLintSummary(lintSummaryResult.status === "fulfilled" ? lintSummaryResult.value : mockLintSummary());

      if (hasFallback) {
        const errorResult = [statusResult, graphResult, queueSummaryResult, vaultSummaryResult, lintSummaryResult].find(
          (result) => result.status === "rejected",
        );
        if (errorResult?.status === "rejected") {
          setActionError(`Dashboard API unavailable, showing mock fallback. ${toErrorMessage(errorResult.reason)}`);
        }
      }

      setBootLoading(false);
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    void api
      .listQueueItems({
        status: queueStatusFilter || undefined,
        sourceType: queueSourceTypeFilter || undefined,
        query: debouncedQueueQuery.trim() || undefined,
        limit: 180,
      })
      .then((payload) => {
        if (!cancelled) {
          setQueueItems(payload);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setUsingFallback(true);
        setQueueItems(
          filterMockQueueList({
            status: queueStatusFilter,
            sourceType: queueSourceTypeFilter,
            query: debouncedQueueQuery,
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [api, debouncedQueueQuery, queueSourceTypeFilter, queueStatusFilter]);

  useEffect(() => {
    let cancelled = false;

    void api
      .listVaultFiles({
        query: debouncedVaultQuery.trim() || undefined,
        sourceType: vaultSourceTypeFilter || undefined,
        queueStatus: vaultQueueStatusFilter || undefined,
        limit: 180,
      })
      .then((payload) => {
        if (!cancelled) {
          setVaultFiles(payload);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setUsingFallback(true);
        setVaultFiles(
          filterMockVaultFiles({
            sourceType: vaultSourceTypeFilter,
            queueStatus: vaultQueueStatusFilter,
            query: debouncedVaultQuery,
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [api, debouncedVaultQuery, vaultQueueStatusFilter, vaultSourceTypeFilter]);

  useEffect(() => {
    let cancelled = false;

    void api
      .listLintIssues({
        level: lintLevelFilter || undefined,
        groupBy: lintGroupByFilter,
        rule: debouncedLintRule.trim() || undefined,
      })
      .then((payload) => {
        if (!cancelled) {
          setLintIssues(payload);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setUsingFallback(true);
        setLintIssues(
          filterMockLintIssues({
            level: lintLevelFilter,
            groupBy: lintGroupByFilter,
            rule: debouncedLintRule,
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [api, debouncedLintRule, lintGroupByFilter, lintLevelFilter]);

  useEffect(() => {
    let cancelled = false;
    const selectedPageId = urlState.selectedPageId;
    if (!selectedPageId) {
      setPageDetail(null);
      setPageSource(null);
      return;
    }

    setPageDetailLoading(true);
    void Promise.allSettled([api.getPageDetail(selectedPageId), api.getPageSource(selectedPageId)]).then((results) => {
      if (cancelled) {
        return;
      }

      const [detailResult, sourceResult] = results;
      const fallbackMode = detailResult.status === "rejected" || sourceResult.status === "rejected";
      if (fallbackMode) {
        setUsingFallback(true);
      }

      setPageDetail(detailResult.status === "fulfilled" ? detailResult.value : mockPageDetail(selectedPageId));
      setPageSource(sourceResult.status === "fulfilled" ? sourceResult.value : mockPageSource(selectedPageId));
      setPageDetailLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api, urlState.selectedPageId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedQueueFileId) {
      setQueueDetail(null);
      return;
    }

    setQueueDetailLoading(true);
    void api.getQueueItemDetail(selectedQueueFileId).then((payload) => {
      if (cancelled) {
        return;
      }
      setQueueDetail(payload);
      setQueueDetailLoading(false);
    }).catch(() => {
      if (cancelled) {
        return;
      }
      setUsingFallback(true);
      setQueueDetail(mockQueueItemDetail(selectedQueueFileId));
      setQueueDetailLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api, selectedQueueFileId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedVaultFileId) {
      setVaultDetail(null);
      return;
    }

    void api.getVaultFileDetail(selectedVaultFileId).then((payload) => {
      if (!cancelled) {
        setVaultDetail(payload);
      }
    }).catch(() => {
      if (cancelled) {
        return;
      }
      setUsingFallback(true);
      setVaultDetail(mockVaultFileDetail(selectedVaultFileId));
    });

    return () => {
      cancelled = true;
    };
  }, [api, selectedVaultFileId]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedSearchQuery.trim()) {
      setSearchPayload(null);
      return;
    }

    setSearchLoading(true);
    void api.searchGraph(debouncedSearchQuery, 18).then((payload) => {
      if (!cancelled) {
        setSearchPayload(payload);
        setSearchLoading(false);
      }
    }).catch(() => {
      if (cancelled) {
        return;
      }
      setUsingFallback(true);
      setSearchPayload(mockSearch(debouncedSearchQuery));
      setSearchLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api, debouncedSearchQuery]);

  const activeTab = urlState.tab;
  const focusedPage =
    pageDetail?.page ??
    graph?.nodes.find((node) => node.id === urlState.selectedPageId) ??
    selectedSearchResults.find((result) => result.id === urlState.selectedPageId) ??
    null;

  function updateUrlState(patch: Partial<DashboardUrlState>) {
    setUrlState((current) => ({
      ...current,
      ...patch,
    }));
  }

  function openPage(pageId: string) {
    updateUrlState({ selectedPageId: pageId });
  }

  function inspectQueueLogs(fileId: string) {
    setLogFileIdFilter("");
    setLogQueryFilter(fileId);
    updateUrlState({ tab: "logs" });
    setDockExpanded(true);
  }

  async function refreshDashboard() {
    setRefreshing(true);
    try {
      const [
        nextStatus,
        nextGraph,
        nextQueueSummary,
        nextQueueItems,
        nextVaultSummary,
        nextVaultFiles,
        nextLintSummary,
        nextLintIssues,
      ] = await Promise.all([
        api.refreshStatus(),
        api.getGraphOverview(),
        api.getQueueSummary(),
        api.listQueueItems({
          status: queueStatusFilter || undefined,
          sourceType: queueSourceTypeFilter || undefined,
          query: debouncedQueueQuery.trim() || undefined,
          limit: 180,
        }),
        api.getVaultSummary(),
        api.listVaultFiles({
          query: debouncedVaultQuery.trim() || undefined,
          sourceType: vaultSourceTypeFilter || undefined,
          queueStatus: vaultQueueStatusFilter || undefined,
          limit: 180,
        }),
        api.getLintSummary(),
        api.listLintIssues({
          level: lintLevelFilter || undefined,
          groupBy: lintGroupByFilter,
          rule: debouncedLintRule.trim() || undefined,
        }),
      ]);

      setStatus(nextStatus);
      setGraph(nextGraph);
      setQueueSummary(nextQueueSummary);
      setQueueItems(nextQueueItems);
      setVaultSummary(nextVaultSummary);
      setVaultFiles(nextVaultFiles);
      setLintSummary(nextLintSummary);
      setLintIssues(nextLintIssues);
      setUsingFallback(false);
      setActionError(null);
    } catch (error) {
      setUsingFallback(true);
      setActionError(`Refresh failed, retaining current snapshot. ${toErrorMessage(error)}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function retryQueueItem(fileId: string) {
    try {
      await api.retryQueueItem(fileId);
      setQueueSummary(await api.getQueueSummary());
      setQueueItems(
        await api.listQueueItems({
          status: queueStatusFilter || undefined,
          sourceType: queueSourceTypeFilter || undefined,
          query: debouncedQueueQuery.trim() || undefined,
          limit: 180,
        }),
      );
      setQueueDetail(await api.getQueueItemDetail(fileId));
    } catch (error) {
      setActionError(`Queue retry failed. ${toErrorMessage(error)}`);
    }
  }

  async function openSource(target: "vault" | "page") {
    if (!urlState.selectedPageId) {
      return;
    }

    setSourceActionPending(true);
    try {
      const result = await api.openPageSource(urlState.selectedPageId, target);
      setSourceActionMessage(`${result.target === "vault" ? "Vault source" : "Page source"} opened: ${result.path}`);
    } catch (error) {
      setSourceActionMessage(`Open source failed. ${toErrorMessage(error)}`);
    } finally {
      setSourceActionPending(false);
    }
  }

  async function openVaultFile(fileId: string) {
    try {
      const result = await api.openVaultFile(fileId);
      setActionError(`Opened ${result.path}`);
    } catch (error) {
      setActionError(`Open vault file failed. ${toErrorMessage(error)}`);
    }
  }

  return (
    <EnvironmentGate>
      <div className="dashboard-root">
        {showIntro ? (
          <ConstellationIgnition
            key={`${introMode}-${introReplayCount}`}
            graph={graph}
            mode={introMode}
            onComplete={() => {
              window.sessionStorage.setItem(INTRO_STORAGE_KEY, "true");
              setShowIntro(false);
            }}
          />
        ) : null}

        <TopBar
          status={status}
          graph={graph}
          queue={queueSummary}
          searchQuery={urlState.query}
          searchResults={selectedSearchResults}
          searchLoading={searchLoading}
          refreshing={refreshing}
          usingFallback={usingFallback}
          onSearchQueryChange={(value) => updateUrlState({ query: value })}
          onSelectSearchResult={(result) => openPage(result.id)}
          onRefresh={() => void refreshDashboard()}
          onReplayIntro={() => {
            if (introReplayTimerRef.current !== null) {
              window.clearTimeout(introReplayTimerRef.current);
            }
            setShowIntro(false);
            introReplayTimerRef.current = window.setTimeout(() => {
              setIntroReplayCount((count) => count + 1);
              setShowIntro(true);
              introReplayTimerRef.current = null;
            }, 0);
          }}
        />

        <LeftRail
          activeTab={activeTab}
          dockExpanded={dockExpanded}
          onSelectTab={(tab) => {
            updateUrlState({ tab });
            setDockExpanded(true);
          }}
          onToggleDock={() => setDockExpanded((value) => !value)}
        />

        <main className="workspace">
          {actionError ? <div className="api-warning">{actionError}</div> : null}
          <GraphCanvas
            graph={graph}
            selectedPageId={urlState.selectedPageId}
            focusedPage={focusedPage}
            loading={refreshing || bootLoading}
            onRefresh={() => void refreshDashboard()}
            onSelectPage={openPage}
          />
        </main>

        <DetailPanel
          pageDetail={pageDetail}
          pageSource={pageSource}
          loading={pageDetailLoading}
          onClose={() => updateUrlState({ selectedPageId: null })}
          onNavigateToPage={openPage}
          onOpenSource={(target) => void openSource(target)}
          sourceActionPending={sourceActionPending}
          sourceActionMessage={sourceActionMessage}
        />

        <BottomDock
          activeTab={activeTab}
          expanded={dockExpanded}
          heightPercent={dockHeightPercent}
          status={status}
          queueSummary={queueSummary}
          queueItems={queueItems}
          queueDetail={queueDetail}
          queueDetailLoading={queueDetailLoading}
          queueStatusFilter={queueStatusFilter}
          queueSourceTypeFilter={queueSourceTypeFilter}
          queueQueryFilter={queueQueryFilter}
          vaultSummary={vaultSummary}
          vaultFiles={vaultFiles}
          vaultDetail={vaultDetail}
          vaultSourceTypeFilter={vaultSourceTypeFilter}
          vaultQueueStatusFilter={vaultQueueStatusFilter}
          vaultQueryFilter={vaultQueryFilter}
          lintSummary={lintSummary}
          lintIssues={lintIssues}
          lintLevelFilter={lintLevelFilter}
          lintGroupByFilter={lintGroupByFilter}
          lintRuleFilter={lintRuleFilter}
          logs={displayLogs}
          logStreamStatus={logStreamStatus}
          logLevelFilter={logLevelFilter}
          logFileIdFilter={logFileIdFilter}
          logQueryFilter={logQueryFilter}
          onTabChange={(tab: DashboardTab) => {
            updateUrlState({ tab });
            setDockExpanded(true);
          }}
          onToggleExpanded={() => setDockExpanded((value) => !value)}
          onHeightPercentChange={setDockHeightPercent}
          onSelectQueueItem={setSelectedQueueFileId}
          onRetryQueueItem={(fileId) => void retryQueueItem(fileId)}
          onQueueStatusFilterChange={setQueueStatusFilter}
          onQueueSourceTypeFilterChange={setQueueSourceTypeFilter}
          onQueueQueryFilterChange={setQueueQueryFilter}
          onInspectQueueLogs={inspectQueueLogs}
          onSelectVaultFile={setSelectedVaultFileId}
          onOpenVaultFile={(fileId) => void openVaultFile(fileId)}
          onVaultSourceTypeFilterChange={setVaultSourceTypeFilter}
          onVaultQueueStatusFilterChange={setVaultQueueStatusFilter}
          onVaultQueryFilterChange={setVaultQueryFilter}
          onOpenPage={openPage}
          onLintLevelFilterChange={setLintLevelFilter}
          onLintGroupByFilterChange={setLintGroupByFilter}
          onLintRuleFilterChange={setLintRuleFilter}
          onLogLevelFilterChange={setLogLevelFilter}
          onLogFileIdFilterChange={setLogFileIdFilter}
          onLogQueryFilterChange={setLogQueryFilter}
        />
      </div>
    </EnvironmentGate>
  );
}
