import type { DashboardTab } from "../types/dashboard";

interface LeftRailProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  dockExpanded: boolean;
  onToggleDock: () => void;
}

const ITEMS: Array<{ tab: DashboardTab; label: string; short: string }> = [
  { tab: "system", label: "System Status", short: "SY" },
  { tab: "queue", label: "Queue", short: "Q" },
  { tab: "logs", label: "Logs", short: "LG" },
  { tab: "vault", label: "Vault", short: "VT" },
  { tab: "lint", label: "Lint", short: "LT" },
];

export function LeftRail({ activeTab, onSelectTab, dockExpanded, onToggleDock }: LeftRailProps) {
  return (
    <aside className="left-rail">
      <div className="left-rail__header">
        <span>WORKBENCH</span>
      </div>
      <nav className="left-rail__nav">
        {ITEMS.map((item) => (
          <button
            key={item.tab}
            className={`left-rail__item ${activeTab === item.tab ? "is-active" : ""}`}
            type="button"
            title={item.label}
            onClick={() => onSelectTab(item.tab)}
          >
            <span>{item.short}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
      <button className="left-rail__dock-toggle" type="button" onClick={onToggleDock}>
        {dockExpanded ? "collapse dock" : "expand dock"}
      </button>
    </aside>
  );
}
