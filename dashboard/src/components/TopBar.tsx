import type { DashboardGraphOverview, DashboardQueueSummary, DashboardSearchResult, DashboardStatus } from "../types/dashboard";
import { formatNumber, formatRelativeTime } from "../utils/format";

interface TopBarProps {
  status: DashboardStatus | null;
  graph: DashboardGraphOverview | null;
  queue: DashboardQueueSummary | null;
  searchQuery: string;
  searchResults: DashboardSearchResult[];
  searchLoading: boolean;
  refreshing: boolean;
  usingFallback: boolean;
  onSearchQueryChange: (value: string) => void;
  onSelectSearchResult: (result: DashboardSearchResult) => void;
  onRefresh: () => void;
  onReplayIntro: () => void;
}

function daemonClass(status: DashboardStatus | null): string {
  if (!status) {
    return "is-unknown";
  }
  if (!status.daemon.running) {
    return "is-error";
  }
  if (status.daemon.lastResult === "error") {
    return "is-warning";
  }
  return "is-live";
}

export function TopBar({
  status,
  graph,
  queue,
  searchQuery,
  searchResults,
  searchLoading,
  refreshing,
  usingFallback,
  onSearchQueryChange,
  onSelectSearchResult,
  onRefresh,
  onReplayIntro,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <h1>Knowledge Constellation</h1>
        <p>local knowledge graph + operations cockpit</p>
      </div>

      <div className="topbar__meta">
        <div className={`daemon-chip ${daemonClass(status)}`}>
          <span className="daemon-chip__dot" />
          <span>{status?.daemon.running ? "daemon online" : "daemon offline"}</span>
          <code>{status?.daemon.currentTask ?? "idle"}</code>
        </div>
        <div className="topbar__counts">
          <span title="total nodes">
            graph <strong>{formatNumber(graph?.totalNodes ?? 0)}</strong>
          </span>
          <span title="visible nodes">
            visible <strong>{formatNumber(graph?.visibleNodeCount ?? 0)}</strong>
          </span>
          <span title="queue pending">
            queue <strong>{formatNumber(queue?.counts.pending ?? 0)}</strong>
          </span>
        </div>
        <div className="topbar__freshness">
          refreshed {formatRelativeTime(status?.generatedAt ?? null)}
          {usingFallback && <em>mock fallback</em>}
        </div>
      </div>

      <div className="topbar__actions">
        <div className="global-search">
          <input
            aria-label="Search across all pages"
            autoComplete="off"
            placeholder="Search whole library…"
            value={searchQuery}
            onInput={(event) =>
              onSearchQueryChange((event.currentTarget as HTMLInputElement).value)
            }
          />
          <span>{searchLoading ? "searching…" : `${searchResults.length} hits`}</span>
          {searchQuery.trim() && searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.slice(0, 12).map((result) => (
                <button
                  key={`${result.id}-${result.searchKind ?? "x"}`}
                  className="search-results__item"
                  onClick={() => onSelectSearchResult(result)}
                  type="button"
                >
                  <strong>{result.title}</strong>
                  <small>
                    <code>{result.pageType}</code>
                    <code>{result.status}</code>
                    {result.updatedAt ? <span>{formatRelativeTime(result.updatedAt)}</span> : null}
                  </small>
                  <p>{result.summaryText || result.filePath}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-ghost" onClick={onReplayIntro} type="button">
          replay ignition
        </button>
        <button className="btn btn-primary" onClick={onRefresh} type="button" disabled={refreshing}>
          {refreshing ? "refreshing…" : "refresh status"}
        </button>
      </div>
    </header>
  );
}
