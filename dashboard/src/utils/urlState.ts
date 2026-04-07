import type { DashboardTab, DashboardUrlState } from "../types/dashboard";

const DEFAULT_TAB: DashboardTab = "system";
const TAB_SET = new Set<DashboardTab>(["system", "queue", "logs", "vault", "lint"]);

export function readUrlState(): DashboardUrlState {
  const search = new URLSearchParams(window.location.search);
  const tabValue = search.get("tab");
  const selectedPageId = search.get("selected");
  const query = search.get("q") ?? "";

  const tab = tabValue && TAB_SET.has(tabValue as DashboardTab) ? (tabValue as DashboardTab) : DEFAULT_TAB;

  return {
    tab,
    selectedPageId: selectedPageId?.trim() || null,
    query,
  };
}

export function writeUrlState(state: DashboardUrlState): void {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", state.tab);

  if (state.selectedPageId) {
    params.set("selected", state.selectedPageId);
  } else {
    params.delete("selected");
  }

  if (state.query.trim()) {
    params.set("q", state.query.trim());
  } else {
    params.delete("q");
  }

  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}
