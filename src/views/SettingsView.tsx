import { AlertCircle, CheckCircle2, DownloadCloud, Languages, Network, RefreshCw, RotateCcw } from "lucide-react";
import type { TFunction } from "../i18n";
import type { AgentCatalogResponse, AppUpdateState, Locale, Scope, UserSettings } from "../types";

interface SettingsViewProps {
  locale: Locale;
  settings: UserSettings;
  agentCatalog: AgentCatalogResponse;
  agentMetadataLoading: boolean;
  appUpdate: AppUpdateState;
  t: TFunction;
  onLocaleChange: (locale: Locale) => void;
  onSettingsChange: (settings: UserSettings) => void;
  onReloadAgents: () => void;
  onCheckAppUpdate: () => void;
  onDownloadAppUpdate: () => void;
  onRelaunchApp: () => void;
}

function formatDate(value: string | undefined, locale: Locale, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function progressPercent(appUpdate: AppUpdateState) {
  if (!appUpdate.contentLength) return null;
  return Math.min(100, Math.round((appUpdate.downloadedBytes / appUpdate.contentLength) * 100));
}

function updateStatusClass(appUpdate: AppUpdateState) {
  if (appUpdate.phase === "upToDate" || appUpdate.phase === "readyToRelaunch") return "status-chip--success";
  if (appUpdate.phase === "error") return "status-chip--danger";
  return "status-chip--warning";
}

function updateStatusLabel(appUpdate: AppUpdateState, t: TFunction) {
  switch (appUpdate.phase) {
    case "checking":
      return t("settings.update.phase.checking");
    case "upToDate":
      return t("settings.update.phase.upToDate");
    case "available":
      return t("settings.update.phase.available");
    case "downloading":
      return t("settings.update.phase.downloading");
    case "readyToRelaunch":
      return t("settings.update.phase.readyToRelaunch");
    case "error":
      return t("settings.update.phase.error");
    case "unsupported":
      return t("settings.update.phase.unsupported");
    default:
      return t("settings.update.phase.idle");
  }
}

export function SettingsView({
  locale,
  settings,
  agentCatalog,
  agentMetadataLoading,
  appUpdate,
  t,
  onLocaleChange,
  onSettingsChange,
  onReloadAgents,
  onCheckAppUpdate,
  onDownloadAppUpdate,
  onRelaunchApp,
}: SettingsViewProps) {
  const universalDir = agentCatalog.agents.find((agent) => agent.isUniversal)?.projectSkillsDir ?? "-";
  const updateProgress = progressPercent(appUpdate);
  const updateBusy = appUpdate.phase === "checking" || appUpdate.phase === "downloading";
  const latestVersion = appUpdate.info?.latestVersion
    ?? (appUpdate.phase === "upToDate" ? appUpdate.currentVersion : undefined)
    ?? "-";

  function patchSettings(patch: Partial<UserSettings>) {
    onSettingsChange({ ...settings, ...patch });
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
      </section>

      <section className="section-panel settings-grid">
        <label className="field-stack">
          {t("settings.language")}
          <div className="select-with-icon">
            <Languages size={15} />
            <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
        </label>

        <label className="field-stack">
          {t("settings.listScope")}
          <select value={settings.defaultScope} onChange={(event) => patchSettings({ defaultScope: event.target.value as Scope })}>
            <option value="global">{t("common.global")} -g</option>
            <option value="project">{t("common.project")} -p</option>
          </select>
        </label>

        <label className="field-stack">
          {t("settings.timeout")}
          <input value={t("settings.timeoutValue")} readOnly />
        </label>
      </section>

      <section className="section-panel">
        <div className="section-panel__head">
          <div>
            <h2>{t("settings.update.title")}</h2>
            <p>{t("settings.update.subtitle")}</p>
          </div>
          <span className={`status-chip ${updateStatusClass(appUpdate)}`}>
            {updateStatusLabel(appUpdate, t)}
          </span>
        </div>

        <div className="update-grid">
          <div>
            <span>{t("settings.update.currentVersion")}</span>
            <strong>{appUpdate.currentVersion ?? "-"}</strong>
          </div>
          <div>
            <span>{t("settings.update.latestVersion")}</span>
            <strong>{latestVersion}</strong>
          </div>
          <div>
            <span>{t("settings.update.lastChecked")}</span>
            <strong>{formatDate(appUpdate.checkedAt, locale, t("settings.update.notChecked"))}</strong>
          </div>
        </div>

        <label className="field-stack update-proxy-field">
          {t("settings.update.proxy")}
          <div className="input-with-icon">
            <Network size={15} />
            <input
              value={settings.updateProxyUrl ?? ""}
              onChange={(event) => patchSettings({ updateProxyUrl: event.target.value })}
              placeholder={t("settings.update.proxyPlaceholder")}
              spellCheck={false}
              disabled={updateBusy}
            />
          </div>
        </label>

        {appUpdate.info?.body ? (
          <div className="update-notes">
            <span>{t("settings.update.releaseNotes")}</span>
            <p>{appUpdate.info.body}</p>
          </div>
        ) : null}

        {appUpdate.phase === "downloading" ? (
          <div className="update-progress" aria-label={t("settings.update.progress")}>
            <div className="update-progress__track">
              <div
                className="update-progress__bar"
                style={{ width: `${updateProgress ?? 12}%` }}
              />
            </div>
            <span>
              {appUpdate.contentLength
                ? t("settings.update.progressKnown", {
                    downloaded: formatBytes(appUpdate.downloadedBytes),
                    total: formatBytes(appUpdate.contentLength),
                    percent: updateProgress ?? 0,
                  })
                : t("settings.update.progressUnknown", {
                    downloaded: formatBytes(appUpdate.downloadedBytes),
                  })}
            </span>
          </div>
        ) : null}

        {appUpdate.error ? (
          <div className="inline-alert">
            <AlertCircle size={15} />
            <span>{appUpdate.error}</span>
          </div>
        ) : appUpdate.phase === "upToDate" ? (
          <div className="inline-alert inline-alert--success">
            <CheckCircle2 size={15} />
            <span>{t("settings.update.upToDateCopy")}</span>
          </div>
        ) : null}

        <div className="action-row">
          <button className="button button--secondary" type="button" onClick={onCheckAppUpdate} disabled={updateBusy}>
            <RefreshCw size={15} className={appUpdate.phase === "checking" ? "spin" : ""} />
            {t("settings.update.checkNow")}
          </button>
          {appUpdate.phase === "available" ? (
            <button className="button button--primary" type="button" onClick={onDownloadAppUpdate}>
              <DownloadCloud size={15} />
              {t("settings.update.downloadAndInstall")}
            </button>
          ) : null}
          {appUpdate.phase === "readyToRelaunch" ? (
            <button className="button button--primary" type="button" onClick={onRelaunchApp}>
              <RotateCcw size={15} />
              {t("settings.update.relaunch")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="section-panel">
        <div className="section-panel__head">
          <div>
            <h2>{t("settings.officialCatalog")}</h2>
            <p>{agentCatalog.packagePath ?? agentCatalog.error ?? t("dashboard.catalogNotLoaded")}</p>
          </div>
          <button className="button button--secondary" type="button" onClick={onReloadAgents} disabled={agentMetadataLoading}>
            <RefreshCw size={15} className={agentMetadataLoading ? "spin" : ""} />
            {agentCatalog.version ?? "-"}
          </button>
        </div>
        <div className="metric-grid compact-metrics">
          <div className="metric-card">
            <span>{t("dashboard.catalogVersion")}</span>
            <strong>{agentCatalog.version ?? "-"}</strong>
            <small>{t("dashboard.catalogAgents", { count: agentCatalog.agents.length })}</small>
          </div>
          <div className="metric-card">
            <span>{t("install.agentGroupUniversal")}</span>
            <strong>{agentCatalog.agents.filter((agent) => agent.isUniversal).length}</strong>
            <small>{universalDir}</small>
          </div>
          <div className="metric-card">
            <span>{t("dashboard.detectedAgents")}</span>
            <strong>{agentCatalog.agents.filter((agent) => agent.detectionStatus === "detected").length}</strong>
            <small>{t("settings.catalogSourceOnly")}</small>
          </div>
        </div>
      </section>

      <section className="section-panel">
        <h2>{t("settings.pathPreview")}</h2>
        <div className="path-list">
          <code>/opt/homebrew/bin</code>
          <code>/usr/local/bin</code>
          <code>~/.nvm/versions/node/current/bin</code>
          <code>~/.volta/bin</code>
          <code>%APPDATA%\npm</code>
        </div>
      </section>
    </div>
  );
}
