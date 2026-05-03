import {
  Download,
  Home,
  Languages,
  PackageCheck,
  RotateCcw,
  Search,
  Settings,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TFunction } from "../i18n";
import type { AgentCatalogResponse, AppUpdateState, EnvironmentOverall, Locale, ViewId } from "../types";
import { StatusChip } from "./StatusChip";

interface AppShellProps {
  activeView: ViewId;
  children: ReactNode;
  environment: EnvironmentOverall;
  locale: Locale;
  agentCatalog: AgentCatalogResponse;
  agentMetadataLoading: boolean;
  appUpdate: AppUpdateState;
  logOpen: boolean;
  t: TFunction;
  onNavigate: (view: ViewId) => void;
  onLocaleChange: (locale: Locale) => void;
  onToggleLog: () => void;
}

const navItems: Array<{ id: ViewId; icon: typeof Home; labelKey: Parameters<TFunction>[0] }> = [
  { id: "dashboard", icon: Home, labelKey: "nav.dashboard" },
  { id: "search", icon: Search, labelKey: "nav.search" },
  { id: "installed", icon: PackageCheck, labelKey: "nav.installed" },
  { id: "install", icon: Download, labelKey: "nav.install" },
  { id: "settings", icon: Settings, labelKey: "nav.settings" },
];

function environmentLabel(environment: EnvironmentOverall, t: TFunction) {
  if (environment === "ready") return t("top.ready");
  if (environment === "partial") return t("top.partial");
  if (environment === "missing") return t("top.missing");
  return t("top.checking");
}

function shouldShowUpdateEntry(appUpdate: AppUpdateState) {
  return ["available", "readyToRelaunch", "error"].includes(appUpdate.phase);
}

function updateEntryLabel(appUpdate: AppUpdateState, t: TFunction) {
  if (appUpdate.phase === "available") {
    return t("top.updateAvailable", { version: appUpdate.info?.latestVersion ?? "-" });
  }
  if (appUpdate.phase === "readyToRelaunch") return t("top.updateReady");
  return t("top.updateFailed");
}

export function AppShell({
  activeView,
  children,
  environment,
  locale,
  agentCatalog,
  agentMetadataLoading,
  appUpdate,
  logOpen,
  t,
  onNavigate,
  onLocaleChange,
  onToggleLog,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__actions">
          <StatusChip value={environment} label={`${t("top.env")}: ${environmentLabel(environment, t)}`} />
          <span className="default-summary">
            {agentMetadataLoading
              ? t("top.catalogLoading")
              : agentCatalog.error
                ? t("top.catalogError")
                : t("top.catalogSummary", {
                    version: agentCatalog.version ?? "-",
                    count: agentCatalog.agents.length,
                  })}
          </span>
          {shouldShowUpdateEntry(appUpdate) ? (
            <button
              className={`topbar-update ${appUpdate.phase === "error" ? "is-error" : ""}`}
              type="button"
              onClick={() => onNavigate("settings")}
            >
              <RotateCcw size={13} />
              {updateEntryLabel(appUpdate, t)}
            </button>
          ) : null}
          <label className="language-select">
            <Languages size={14} aria-hidden="true" />
            <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <button
            className={`button button--secondary ${logOpen ? "is-active" : ""}`}
            type="button"
            onClick={onToggleLog}
          >
            <TerminalSquare size={14} />
            {t("top.log")}
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="Primary">
          <div className="sidebar-section-label">{t("nav.sectionViews")}</div>
          {navItems.filter((item) => item.id !== "settings").map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-button ${activeView === item.id ? "is-active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={15} />
                {t(item.labelKey)}
              </button>
            );
          })}
          <div className="sidebar-section-label">{t("nav.sectionSystem")}</div>
          <button
            type="button"
            className={`nav-button ${activeView === "settings" ? "is-active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <Settings size={15} />
            {t("nav.settings")}
          </button>
        </aside>
        <main className="main-panel">{children}</main>
      </div>
    </div>
  );
}
