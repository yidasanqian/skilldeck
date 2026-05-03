import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildInstallArgs, formatCommand } from "../api/skills";
import type { TFunction } from "../i18n";
import type { AgentInfo, AgentCatalogResponse, InstallDefaultsResponse, InstallDraft, Scope, SkillInstallRequest } from "../types";

interface InstallViewProps {
  draft: InstallDraft | null;
  agentCatalog: AgentCatalogResponse;
  installDefaults: InstallDefaultsResponse;
  agentMetadataLoading: boolean;
  canMutate: boolean;
  t: TFunction;
  onReloadAgents: () => void;
  onInstall: (request: SkillInstallRequest) => void;
}

type AgentGroupId = "universal" | "detected" | "other" | "hidden";
const PROJECT_PATH_STORAGE_KEY = "skilldeck:lastProjectPath";

function parseSkillNames(input: string) {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function uniqueInstallDirs(agents: AgentInfo[], selectedAgents: string[], scope: Scope) {
  return new Set(
    selectedAgents
      .map((agentId) => agents.find((agent) => agent.id === agentId))
      .filter((agent): agent is AgentInfo => Boolean(agent))
      .map((agent) => (scope === "global" ? agent?.globalSkillsDir : agent?.projectSkillsDir))
      .filter((dir): dir is string => Boolean(dir)),
  );
}

function officialCopyDefault(agents: AgentInfo[], selectedAgents: string[], scope: Scope) {
  if (selectedAgents.length === 0) return false;
  return uniqueInstallDirs(agents, selectedAgents, scope).size <= 1;
}

function loadLastProjectPath() {
  return window.localStorage.getItem(PROJECT_PATH_STORAGE_KEY) ?? "";
}

function persistLastProjectPath(path: string) {
  const trimmed = path.trim();
  if (trimmed) {
    window.localStorage.setItem(PROJECT_PATH_STORAGE_KEY, trimmed);
  }
}

function joinDisplayPath(base: string, relativePath: string) {
  const normalizedBase = base.trim().replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "");
  if (!normalizedBase) return normalizedRelative;
  if (!normalizedRelative) return normalizedBase;
  return `${normalizedBase}/${normalizedRelative}`;
}

function groupLabel(group: AgentGroupId, t: TFunction) {
  if (group === "universal") return t("install.agentGroupUniversal");
  if (group === "detected") return t("install.agentGroupDetected");
  if (group === "hidden") return t("install.agentGroupHidden");
  return t("install.agentGroupOther");
}

function detectionLabel(agent: AgentInfo, t: TFunction) {
  if (agent.detectionStatus === "detected") return t("install.detected");
  if (agent.detectionStatus === "missing") return t("install.missing");
  return t("install.unknown");
}

function groupAgents(agents: AgentInfo[]) {
  return {
    universal: agents.filter((agent) => agent.isUniversal && !agent.hidden),
    detected: agents.filter((agent) => !agent.isUniversal && !agent.hidden && agent.detectionStatus === "detected"),
    other: agents.filter((agent) => !agent.isUniversal && !agent.hidden && agent.detectionStatus !== "detected"),
    hidden: agents.filter((agent) => agent.hidden),
  } satisfies Record<AgentGroupId, AgentInfo[]>;
}

export function InstallView({
  draft,
  agentCatalog,
  installDefaults,
  agentMetadataLoading,
  canMutate,
  t,
  onReloadAgents,
  onInstall,
}: InstallViewProps) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState(draft?.source ?? "anthropics/skills");
  const [skillInput, setSkillInput] = useState(draft?.skillNames.join(", ") ?? "frontend-design");
  const [agents, setAgents] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(installDefaults.defaultScope);
  const [projectPath, setProjectPath] = useState(loadLastProjectPath);
  const [copy, setCopy] = useState(installDefaults.defaultCopy);
  const [copyTouched, setCopyTouched] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");

  useEffect(() => {
    if (!draft) return;
    setSource(draft.source);
    setSkillInput(draft.skillNames.join(", "));
    setStep(1);
  }, [draft]);

  useEffect(() => {
    const detectedCatalogIds = new Set(
      agentCatalog.agents
        .filter((agent) => agent.detectionStatus === "detected")
        .map((agent) => agent.id),
    );
    setAgents(installDefaults.defaultAgents.filter((agent) => detectedCatalogIds.has(agent)));
    setScope(installDefaults.defaultScope);
    setCopy(installDefaults.defaultCopy);
    setCopyTouched(false);
  }, [agentCatalog.agents, installDefaults.defaultAgents, installDefaults.defaultScope, installDefaults.defaultCopy]);

  const skillNames = useMemo(() => parseSkillNames(skillInput), [skillInput]);
  const visibleAgents = useMemo(() => {
    const query = normalize(agentQuery);
    if (!query) return agentCatalog.agents;
    return agentCatalog.agents.filter((agent) =>
      normalize(`${agent.id} ${agent.displayName} ${agent.projectSkillsDir} ${agent.globalSkillsDir ?? ""}`).includes(query),
    );
  }, [agentCatalog.agents, agentQuery]);
  const groupedAgents = useMemo(() => groupAgents(visibleAgents), [visibleAgents]);
  const computedCopyDefault = useMemo(
    () => officialCopyDefault(agentCatalog.agents, agents, scope),
    [agentCatalog.agents, agents, scope],
  );

  useEffect(() => {
    if (!copyTouched) setCopy(computedCopyDefault);
  }, [computedCopyDefault, copyTouched]);

  const request = useMemo<SkillInstallRequest>(
    () => ({
      source: source.trim(),
      skillNames,
      agents,
      scope,
      projectPath: scope === "project" ? projectPath.trim() : undefined,
      copy,
    }),
    [agents, copy, projectPath, scope, skillNames, source],
  );

  const error = agentCatalog.error
    ? t("install.catalogUnavailable")
    : !source.trim()
      ? t("install.missingSource")
      : skillNames.length === 0
        ? t("install.missingSkill")
        : agents.length === 0
          ? t("install.missingAgent")
          : scope === "project" && !projectPath.trim()
            ? t("install.missingProjectPath")
          : "";
  const installDirs = Array.from(uniqueInstallDirs(agentCatalog.agents, agents, scope));
  const displayInstallDirs = installDirs.map((dir) => (scope === "project" ? joinDisplayPath(projectPath, dir) : dir));

  function toggleAgent(agentId: string) {
    setAgents((current) =>
      current.includes(agentId) ? current.filter((item) => item !== agentId) : [...current, agentId],
    );
  }

  function changeCopy(next: boolean) {
    setCopy(next);
    setCopyTouched(true);
  }

  function changeProjectPath(next: string) {
    const trimmed = next.trim();
    setProjectPath(trimmed);
    persistLastProjectPath(trimmed);
  }

  async function chooseProjectPath() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("install.projectPathDialogTitle"),
    });
    if (typeof selected === "string") {
      changeProjectPath(selected);
    }
  }

  function nextStep() {
    setStep((current) => Math.min(current + 1, 4));
  }

  function previousStep() {
    setStep((current) => Math.max(current - 1, 1));
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>{t("install.title")}</h1>
          <p>{t("install.subtitle")}</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onReloadAgents} disabled={agentMetadataLoading}>
          <RefreshCw size={15} className={agentMetadataLoading ? "spin" : ""} />
          {t("dashboard.reloadAgents")}
        </button>
      </section>

      <section className="section-panel wizard-panel">
        <div className="wizard-steps">
          {[1, 2, 3, 4].map((item) => (
            <button key={item} className={step === item ? "is-active" : ""} type="button" onClick={() => setStep(item)}>
              <span>{item}</span>
              {t(`install.step${item}` as Parameters<TFunction>[0])}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <div className="form-grid">
            <label className="field-stack wide">
              {t("common.source")}
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t("install.sourcePlaceholder")} />
            </label>
            <label className="field-stack wide">
              {t("install.skillNames")}
              <input value={skillInput} onChange={(event) => setSkillInput(event.target.value)} placeholder={t("install.skillPlaceholder")} />
            </label>
            <div className="field-stack wide">
              {t("common.skills")}
              <div className="chip-row">
                {skillNames.length > 0 ? skillNames.map((skill) => <span key={skill} className="static-chip">{skill}</span>) : <span className="muted">{t("common.none")}</span>}
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="agent-picker">
            {agentCatalog.error ? <div className="notice notice--warning">{agentCatalog.error}</div> : null}
            <div className="search-row compact-search">
              <input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder={t("install.agentSearch")} />
              <span className="muted">{t("install.selectedAgents", { count: agents.length })}</span>
            </div>
            {(["universal", "detected", "other", "hidden"] as AgentGroupId[]).map((group) => {
              const items = groupedAgents[group];
              if (items.length === 0) return null;
              return (
                <div className="agent-group" key={group}>
                  <h3>{groupLabel(group, t)}</h3>
                  <div className="agent-grid">
                    {items.map((agent) => (
                      <button
                        key={agent.id}
                        className={`agent-option ${agents.includes(agent.id) ? "is-active" : ""}`}
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        disabled={Boolean(agentCatalog.error)}
                      >
                        <span className="agent-option__title">
                          <strong>{agent.displayName}</strong>
                          <code>{agent.id}</code>
                        </span>
                        <span className={`agent-detection agent-detection--${agent.detectionStatus}`}>
                          {detectionLabel(agent, t)}
                        </span>
                        <span>{t("install.projectDir")}: <code>{agent.projectSkillsDir || "-"}</code></span>
                        <span>{t("install.globalDir")}: <code>{agent.globalSkillsDir ?? "-"}</code></span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="form-grid">
            <label className="field-stack wide">
              {t("common.scope")}
              <div className="segmented">
                <button className={scope === "project" ? "is-active" : ""} type="button" onClick={() => setScope("project")}>
                  {t("common.project")} -p
                </button>
                <button className={scope === "global" ? "is-active" : ""} type="button" onClick={() => setScope("global")}>
                  {t("common.global")} -g
                </button>
              </div>
              <span className="hint-text">{t("install.scopeFromCli")}</span>
            </label>
            {scope === "project" ? (
              <label className="field-stack wide">
                {t("install.projectPath")}
                <div className="input-with-action">
                  <input
                    value={projectPath}
                    onChange={(event) => changeProjectPath(event.target.value)}
                    placeholder={t("install.projectPathPlaceholder")}
                  />
                  <button className="button button--secondary" type="button" onClick={() => void chooseProjectPath()}>
                    <FolderOpen size={15} />
                    {t("install.chooseProjectPath")}
                  </button>
                </div>
                <span className="hint-text">{t("install.projectPathHint")}</span>
              </label>
            ) : null}
            <label className="field-stack wide">
              {t("install.installMode")}
              <div className="segmented">
                <button className={!copy ? "is-active" : ""} type="button" onClick={() => changeCopy(false)}>
                  {t("install.symlinkMode")}
                </button>
                <button className={copy ? "is-active" : ""} type="button" onClick={() => changeCopy(true)}>
                  {t("install.copyMode")}
                </button>
              </div>
              <span className="hint-text">
                {t("install.copyDefaultHint", { mode: computedCopyDefault ? t("install.copyMode") : t("install.symlinkMode") })}
              </span>
            </label>
            <div className="field-stack wide">
              {t("install.targetDirs")}
              <div className="path-list">
                {displayInstallDirs.length > 0
                  ? displayInstallDirs.map((dir) => <code key={dir}>{dir}</code>)
                  : <span className="muted">{t("common.none")}</span>}
              </div>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="confirm-grid">
            <div><span>{t("common.source")}</span><strong>{request.source || t("common.none")}</strong></div>
            <div><span>{t("common.skills")}</span><strong>{request.skillNames.join(", ") || t("common.none")}</strong></div>
            <div><span>{t("common.agent")}</span><strong>{request.agents.join(", ") || t("common.none")}</strong></div>
            <div><span>{t("common.scope")}</span><strong>{request.scope === "global" ? `${t("common.global")} -g` : `${t("common.project")} -p`}</strong></div>
            {request.scope === "project" ? <div><span>{t("install.projectPath")}</span><strong>{request.projectPath || t("common.none")}</strong></div> : null}
            <div><span>{t("install.installMode")}</span><strong>{request.copy ? "--copy" : t("install.symlinkOrDefault")}</strong></div>
          </div>
        ) : null}

        <div className="wizard-actions">
          <button className="button button--secondary" type="button" onClick={previousStep} disabled={step === 1}>
            {t("install.previous")}
          </button>
          <button className="button button--secondary" type="button" onClick={nextStep} disabled={step === 4}>
            {t("install.next")}
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-panel__head">
          <div>
            <h2>{t("install.commandPreview")}</h2>
            <p>{error || t("install.commandMatchesSelection")}</p>
          </div>
        </div>
        <div className="command-with-action">
          <div className="command-preview-stack">
            {request.scope === "project" ? <code className="cwd-preview">cwd: {request.projectPath || t("common.none")}</code> : null}
            <code className="command-preview">{formatCommand(buildInstallArgs(request))}</code>
          </div>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onInstall(request)}
            disabled={!canMutate || Boolean(error)}
          >
            <Download size={15} />
            {t("install.ready")}
          </button>
        </div>
      </section>
    </div>
  );
}
