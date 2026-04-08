import type { DashboardTab } from "../types/dashboard";

export type RailMode = "overview" | "search" | "system" | "queue" | "logs";

interface LeftRailProps {
  activeMode: RailMode;
  onActivateMode: (mode: RailMode) => void;
  dockExpanded: boolean;
  onToggleDock: () => void;
}

const ITEMS: Array<{ mode: RailMode; label: string; icon: string; tab?: DashboardTab }> = [
  { mode: "overview", label: "Observatory", icon: "◎" },
  { mode: "search", label: "Search Sweep", icon: "⌕" },
  { mode: "system", label: "System Pulse", icon: "◫", tab: "system" },
  { mode: "queue", label: "Queue Flow", icon: "⌁", tab: "queue" },
  { mode: "logs", label: "Log Stream", icon: "⋰", tab: "logs" },
];

export function LeftRail({ activeMode, onActivateMode, dockExpanded, onToggleDock }: LeftRailProps) {
  return (
    <aside className="left-rail">
      <div className="left-rail__header">
        <span className="shell-eyebrow">Orbit</span>
      </div>
      <nav className="left-rail__nav">
        {ITEMS.map((item) => (
          <button
            key={item.mode}
            className={`left-rail__item ${activeMode === item.mode ? "is-active" : ""}`}
            type="button"
            data-label={item.label}
            title={item.label}
            onClick={() => onActivateMode(item.mode)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>

      <div className="left-rail__footer">
        <button className="left-rail__dock-toggle" type="button" onClick={onToggleDock}>
          <span>dock</span>
          <strong>{dockExpanded ? "live" : "idle"}</strong>
        </button>
      </div>
    </aside>
  );
}
