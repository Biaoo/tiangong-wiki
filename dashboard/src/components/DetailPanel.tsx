import type { DashboardPageDetailResponse, DashboardPageSourceResponse, DashboardPageSummary } from "../types/dashboard";
import { formatDateTime } from "../utils/format";

interface DetailPanelProps {
  pageDetail: DashboardPageDetailResponse | null;
  pageSource: DashboardPageSourceResponse | null;
  loading: boolean;
  onClose: () => void;
  onNavigateToPage: (pageId: string) => void;
  onOpenSource: (target: "vault" | "page") => void;
  sourceActionPending: boolean;
  sourceActionMessage: string | null;
}

function resolveRelationPage(
  relation: DashboardPageDetailResponse["relations"][number],
): DashboardPageSummary | null {
  return relation.direction === "incoming" ? relation.source ?? null : relation.target ?? null;
}

function previewText(source: DashboardPageSourceResponse | null): string {
  if (!source) {
    return "Select a node to inspect page source.";
  }
  if (source.vaultSource?.preview) {
    return source.vaultSource.preview;
  }
  if (source.pageSource.rawMarkdown) {
    return source.pageSource.rawMarkdown.slice(0, 1200);
  }
  if (source.vaultSource?.previewError) {
    return source.vaultSource.previewError;
  }
  return "No preview available.";
}

export function DetailPanel({
  pageDetail,
  pageSource,
  loading,
  onClose,
  onNavigateToPage,
  onOpenSource,
  sourceActionPending,
  sourceActionMessage,
}: DetailPanelProps) {
  return (
    <aside className={`detail-panel ${pageDetail ? "is-open" : ""}`}>
      <header>
        <strong>Node Detail</strong>
        <button type="button" onClick={onClose}>
          close
        </button>
      </header>

      {!pageDetail && !loading ? (
        <div className="detail-panel__empty">
          <p>Choose a node from the graph or search to inspect page metadata and source references.</p>
        </div>
      ) : null}

      {loading ? (
        <div className="detail-panel__empty">
          <p>Loading node detail…</p>
        </div>
      ) : null}

      {pageDetail ? (
        <div className="detail-panel__content">
          <section className="detail-card">
            <h3>{pageDetail.page.title}</h3>
            <div className="detail-tags">
              <code>{pageDetail.page.pageType}</code>
              <code>{pageDetail.page.status}</code>
              <code>{pageDetail.page.nodeKey}</code>
            </div>
            <p>{pageDetail.page.summaryText || "No summary generated for this page yet."}</p>
            <dl>
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(pageDetail.page.updatedAt)}</dd>
              </div>
              <div>
                <dt>Outgoing</dt>
                <dd>{pageDetail.relationCounts.outgoing}</dd>
              </div>
              <div>
                <dt>Incoming</dt>
                <dd>{pageDetail.relationCounts.incoming}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>
                  <code>{pageDetail.page.pagePath}</code>
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-card">
            <h4>Relations</h4>
            {pageDetail.relations.length === 0 ? <p className="muted">No relations for current node.</p> : null}
            {pageDetail.relations.slice(0, 24).map((relation, index) => {
              const page = resolveRelationPage(relation);
              if (!page) {
                return (
                  <div key={`${relation.direction}-${relation.edgeType}-${index}`} className="relation-item">
                    <span>
                      <strong>{relation.rawSource ?? relation.rawTarget ?? "unresolved target"}</strong>
                      <small>
                        {relation.direction} · {relation.edgeType}
                      </small>
                    </span>
                    <code>raw</code>
                  </div>
                );
              }

              return (
                <button
                  key={`${relation.direction}-${page.id}-${relation.edgeType}-${index}`}
                  className="relation-item"
                  type="button"
                  onClick={() => onNavigateToPage(page.id)}
                >
                  <span>
                    <strong>{page.title}</strong>
                    <small>
                      {relation.direction} · {relation.edgeType}
                    </small>
                  </span>
                  <code>{page.pageType}</code>
                </button>
              );
            })}
          </section>

          <section className="detail-card">
            <h4>Source Preview / Open</h4>
            <p className="muted">
              {pageSource?.vaultSource?.fileId
                ? `Vault source: ${pageSource.vaultSource.fileId}`
                : pageSource?.vaultSource?.previewError ?? "Vault preview unavailable. You can still open page source."}
            </p>
            <pre>{previewText(pageSource)}</pre>
            <div className="detail-card__actions">
              <button type="button" onClick={() => onOpenSource("page")} disabled={sourceActionPending}>
                open page source
              </button>
              <button type="button" onClick={() => onOpenSource("vault")} disabled={sourceActionPending}>
                open vault source
              </button>
            </div>
            {sourceActionMessage ? <p className="detail-card__message">{sourceActionMessage}</p> : null}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
