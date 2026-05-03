import { ArrowRight, RefreshCw } from "lucide-react";
import type { TFunction } from "../i18n";
import type { AgentCatalogResponse, CommandResult, EnvironmentCheck, EnvironmentStatus, InstallDefaultsResponse, ViewId } from "../types";
import { StatusChip } from "../components/StatusChip";

interface DashboardViewProps {
  environment: EnvironmentStatus;
  installedCount: number;
  checking: boolean;
  agentCatalog: AgentCatalogResponse;
  installDefaults: InstallDefaultsResponse;
  agentMetadataLoading: boolean;
  recentCommands: CommandResult[];
  t: TFunction;
  onRecheck: () => void;
  onReloadAgents: () => void;
  onNavigate: (view: ViewId) => void;
}

function EnvironmentCard({ check }: { check: EnvironmentCheck }) {
  return (
    <div className="metric-card">
      <span>{check.name}</span>
      <strong>{check.ok ? "OK" : "Missing"}</strong>
      <small>{check.detail}</small>
    </div>
  );
}

function environmentCopy(status: EnvironmentStatus, t: TFunction) {
  if (status.overall === "ready") return t("dashboard.readyCopy");
  if (status.overall === "missing") return t("dashboard.missingCopy");
  return t("dashboard.partialCopy");
}

function catalogStatusText(
  catalog: AgentCatalogResponse,
  loading: boolean,
  t: TFunction,
) {
  if (loading) return t("top.catalogLoading");
  return catalog.packagePath ?? catalog.error ?? t("dashboard.catalogNotLoaded");
}

export function DashboardView({
  environment,
  installedCount,
  checking,
  agentCatalog,
  installDefaults,
  agentMetadataLoading,
  recentCommands,
  t,
  onRecheck,
  onReloadAgents,
  onNavigate,
}: DashboardViewProps) {
  const detectedCount = agentCatalog.agents.filter((agent) => agent.detectionStatus === "detected").length;

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>{t("dashboard.title")}</h1>
          <p>{t("dashboard.subtitle")}</p>
        </div>
        <button className="button button--primary" type="button" onClick={onRecheck} disabled={checking}>
          <RefreshCw size={15} className={checking ? "spin" : ""} />
          {t("dashboard.recheck")}
        </button>
      </section>

      <section className="section-panel">
        <div className="section-panel__head">
          <div>
            <h2>{t("dashboard.cliVersion")}</h2>
            <p>{environmentCopy(environment, t)}</p>
          </div>
          <StatusChip value={environment.overall} label={environment.overall} />
        </div>
        <div className="metric-grid">
          <EnvironmentCard check={environment.node} />
          <EnvironmentCard check={environment.npx} />
          <EnvironmentCard check={environment.skills} />
          <div className="metric-card">
            <span>{t("dashboard.lastChecked")}</span>
            <strong>{environment.version ?? t("dashboard.notChecked")}</strong>
            <small>{environment.checkedAt ? new Date(environment.checkedAt).toLocaleString() : t("dashboard.notChecked")}</small>
          </div>
        </div>
      </section>

      <div className="two-column">
        <section className="section-panel">
          <div className="section-panel__head">
            <div>
              <h2>{t("dashboard.agentCatalog")}</h2>
              <p>{catalogStatusText(agentCatalog, agentMetadataLoading, t)}</p>
            </div>
            <button className="button button--secondary" type="button" onClick={onReloadAgents} disabled={agentMetadataLoading}>
              <RefreshCw size={15} className={agentMetadataLoading ? "spin" : ""} />
              {t("dashboard.reloadAgents")}
            </button>
          </div>
          <div className="metric-grid compact-metrics">
            <div className="metric-card">
              <span>{t("dashboard.catalogVersion")}</span>
              <strong>{agentCatalog.version ?? "-"}</strong>
              <small>{t("dashboard.catalogAgents", { count: agentCatalog.agents.length })}</small>
            </div>
            <div className="metric-card">
              <span>{t("dashboard.detectedAgents")}</span>
              <strong>{detectedCount}</strong>
              <small>{installDefaults.detectedAgents.join(", ") || t("common.none")}</small>
            </div>
            <div className="metric-card">
              <span>{t("dashboard.cliDefaults")}</span>
              <strong>{installDefaults.needsAgentSelection ? t("install.needsAgentSelection") : installDefaults.defaultAgents.length}</strong>
              <small>{installDefaults.defaultAgents.join(", ") || t("common.none")}</small>
            </div>
            <div className="metric-card">
              <span>{t("dashboard.installedCount")}</span>
              <strong>{installedCount}</strong>
              <small>{t("installed.scopeOnlyHint")}</small>
            </div>
          </div>
          <div className="action-row">
            <button className="button button--secondary" type="button" onClick={() => onNavigate("search")}>
              {t("dashboard.openSearch")}
              <ArrowRight size={15} />
            </button>
            <button className="button button--secondary" type="button" onClick={() => onNavigate("installed")}>
              {t("dashboard.openInstalled")}
              <ArrowRight size={15} />
            </button>
          </div>
        </section>

        <section className="section-panel">
          <h2>{t("dashboard.pathPreview")}</h2>
          <div className="path-list">
            {environment.pathPreview.map((path) => (
              <code key={path}>{path}</code>
            ))}
          </div>
        </section>
      </div>

      <section className="section-panel">
        <h2>{t("dashboard.recent")}</h2>
        {recentCommands.length === 0 ? (
          <div className="empty-state compact">{t("log.empty")}</div>
        ) : (
          <div className="recent-list">
            {recentCommands.slice(0, 5).map((command) => (
              <div className="recent-list__item" key={command.id}>
                <StatusChip value={command.status} label={command.status} />
                <code>{command.args.slice(0, 4).join(" ")}</code>
                <span>{command.durationMs ? `${command.durationMs}ms` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
