import { Languages, RefreshCw } from "lucide-react";
import type { TFunction } from "../i18n";
import type { AgentCatalogResponse, Locale, Scope, UserSettings } from "../types";

interface SettingsViewProps {
  locale: Locale;
  settings: UserSettings;
  agentCatalog: AgentCatalogResponse;
  agentMetadataLoading: boolean;
  t: TFunction;
  onLocaleChange: (locale: Locale) => void;
  onSettingsChange: (settings: UserSettings) => void;
  onReloadAgents: () => void;
}

export function SettingsView({
  locale,
  settings,
  agentCatalog,
  agentMetadataLoading,
  t,
  onLocaleChange,
  onSettingsChange,
  onReloadAgents,
}: SettingsViewProps) {
  const universalDir = agentCatalog.agents.find((agent) => agent.isUniversal)?.projectSkillsDir ?? "-";

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
