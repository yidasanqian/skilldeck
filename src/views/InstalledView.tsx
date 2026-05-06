import { RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { buildRemoveArgs, buildUpdateArgs, formatCommand } from "../api/skills";
import { CopyButton } from "../components/CopyButton";
import type { TFunction } from "../i18n";
import type { AgentCatalogResponse, AgentInfo, Scope, SkillRecord } from "../types";
import { formatTerminalOutput } from "../utils/terminal";

interface InstalledViewProps {
  skills: SkillRecord[];
  rawOutput: string;
  loading: boolean;
  parsed: boolean;
  defaultScope: Scope;
  defaultProjectPath: string;
  agentCatalog: AgentCatalogResponse;
  t: TFunction;
  onProjectPathChange: (path: string) => void;
  onRefresh: (scope: Scope, projectPath?: string) => void;
  onCheckPaths: (paths: string[]) => Promise<string[]>;
  onRemove: (skill: SkillRecord) => void;
  onUpdate: (skill: SkillRecord) => void;
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function pathMatchesDir(path: string, dir: string) {
  const normalizedPath = normalizePath(path);
  const normalizedDir = normalizePath(dir);
  if (!normalizedDir) return false;
  if (normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}/`)) return true;
  return !normalizedDir.startsWith("/") && normalizedPath.includes(`/${normalizedDir}/`);
}

function matchingAgents(path: string, agents: AgentInfo[]) {
  return agents.filter((agent) => {
    const dirs = [agent.globalSkillsDir, agent.projectSkillsDir].filter(Boolean) as string[];
    return dirs.some((dir) => pathMatchesDir(path, dir));
  });
}

function normalizeAgentName(name: string) {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function agentNameMatches(agent: AgentInfo, name: string) {
  const normalized = normalizeAgentName(name);
  return normalized === normalizeAgentName(agent.id) || normalized === normalizeAgentName(agent.displayName);
}

function explicitLinkedAgents(skill: SkillRecord, agents: AgentInfo[]) {
  if (skill.agents.length === 0) return [];
  return agents.filter((agent) => skill.agents.some((name) => agentNameMatches(agent, name)));
}

function projectRootFromSource(canonicalDir: string, agents: AgentInfo[]) {
  for (const agent of agents) {
    const relativeDir = normalizePath(agent.projectSkillsDir);
    if (!relativeDir || relativeDir.startsWith("/")) continue;
    if (canonicalDir.endsWith(`/${relativeDir}`)) {
      return canonicalDir.slice(0, -relativeDir.length - 1);
    }
  }
  return null;
}

function agentInstallDir(skill: SkillRecord, agent: AgentInfo, canonicalDir: string, catalog: AgentCatalogResponse) {
  if (skill.scope === "global") return agent.globalSkillsDir ?? null;
  const projectDir = normalizePath(agent.projectSkillsDir);
  if (!projectDir) return null;
  if (projectDir.startsWith("/")) return projectDir;
  const projectRoot = projectRootFromSource(canonicalDir, catalog.agents);
  return projectRoot ? `${projectRoot}/${projectDir}` : null;
}

function symlinkPaths(skill: SkillRecord, catalog: AgentCatalogResponse): string[] {
  const normalizedSource = normalizePath(skill.source);
  const lastSlash = normalizedSource.lastIndexOf("/");
  if (lastSlash < 0) return [];  // source 无路径分隔符，无法推算软链位置
  const canonicalDir = normalizedSource.substring(0, lastSlash);
  const paths = explicitLinkedAgents(skill, catalog.agents).flatMap((agent) => {
    const dir = agentInstallDir(skill, agent, canonicalDir, catalog);
    if (!dir) return [];
    const normalizedDir = normalizePath(dir);
    if (normalizedDir === canonicalDir) return [];  // 排除规范路径自身所在的目录
    return [`${normalizedDir}/${skill.name}`];
  });
  return [...new Set(paths)];
}

function locationLabel(path: string, catalog: AgentCatalogResponse, t: TFunction) {
  const matches = matchingAgents(path, catalog.agents);
  if (matches.length === 0) return t("installed.locationUnknown");
  if (matches.some((agent) => agent.isUniversal)) {
    return `${t("installed.locationUniversal")} (${matches.filter((agent) => agent.isUniversal).length})`;
  }
  return matches.map((agent) => agent.displayName).join(", ");
}

export function InstalledView({
  skills,
  rawOutput,
  loading,
  parsed,
  defaultScope,
  defaultProjectPath,
  agentCatalog,
  t,
  onProjectPathChange,
  onRefresh,
  onCheckPaths,
  onRemove,
  onUpdate,
}: InstalledViewProps) {
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [projectPath, setProjectPath] = useState(defaultProjectPath);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const [verifiedPathsById, setVerifiedPathsById] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const pathToSkillId = new Map<string, string>();
    const allPaths: string[] = [];
    for (const skill of skills) {
      for (const p of symlinkPaths(skill, agentCatalog)) {
        // 同一路径理论上只归属一个 skill；重复时取先遇到的
        if (!pathToSkillId.has(p)) {
          allPaths.push(p);
          pathToSkillId.set(p, skill.id);
        }
      }
    }
    if (allPaths.length === 0) {
      setVerifiedPathsById(new Map());
      return () => { cancelled = true; };
    }
    void onCheckPaths(allPaths)
      .then((existing) => {
        if (cancelled) return;
        const result = new Map<string, string[]>();
        for (const p of existing) {
          const skillId = pathToSkillId.get(p);
          if (skillId) {
            const current = result.get(skillId) ?? [];
            current.push(p);
            result.set(skillId, current);
          }
        }
        setVerifiedPathsById(result);
      })
      .catch(() => {
        if (cancelled) return;
        setVerifiedPathsById(new Map());
      });
    return () => { cancelled = true; };
  }, [skills, agentCatalog, onCheckPaths]);

  useEffect(() => {
    onRefresh(scope, scope === "project" ? projectPath : undefined);
  }, [onRefresh, projectPath, scope]);

  function changeProjectPath(next: string) {
    setProjectPath(next);
    onProjectPathChange(next);
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <div className="title-row">
            <h1>{t("installed.title")}</h1>
            <span className="title-badge">
              {scope === "global" ? t("common.global") : t("common.project")} · {skills.length}
            </span>
          </div>
          <p>{t("installed.subtitle")}</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => onRefresh(scope)} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          {t("common.refresh")}
        </button>
      </section>

      <section className="section-panel">
        <div className="toolbar-row">
          <label>
            {t("common.scope")}
            <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
              <option value="global">{t("common.global")} -g</option>
              <option value="project">{t("common.project")} -p</option>
            </select>
          </label>
          {scope === "project" ? (
            <label>
              {t("install.projectPath")}
              <input
                type="text"
                value={projectPath}
                onChange={(event) => changeProjectPath(event.target.value)}
                placeholder={t("install.projectPathPlaceholder")}
              />
            </label>
          ) : null}
        </div>
        <p className="hint-text">{t("installed.scopeOnlyHint")}</p>
      </section>

      <section className="section-panel">
        {!parsed ? <div className="notice notice--warning">{t("installed.parseFailed")}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("common.skill")}</th>
                <th>{t("installed.path")}</th>
                <th>{t("installed.locationType")}</th>
                <th>{t("installed.linkedAgents")}</th>
                <th>{t("common.scope")}</th>
                <th>{t("installed.updated")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <strong>{skill.name}</strong>
                    {skill.description ? <small>{skill.description}</small> : null}
                  </td>
                  <td>
                    <div className="symlink-cell">
                      <code>{skill.source}</code>
                      {(() => {
                        const links = verifiedPathsById.get(skill.id) ?? [];
                        if (links.length === 0) return null;
                        const expanded = expandedRows.has(skill.id);
                        return (
                          <>
                            <button
                              className="symlink-toggle"
                              type="button"
                              onClick={() => toggleRow(skill.id)}
                            >
                              {expanded
                                ? t("installed.symlinkCollapse")
                                : t("installed.symlinkPaths", { count: links.length })}
                            </button>
                            {expanded ? (
                              <div className="symlink-list">
                                {links.map((p) => (
                                  <div key={p} className="symlink-item">
                                    <span className="symlink-arrow">↳</span>
                                    <code>{p}</code>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td>{locationLabel(skill.source, agentCatalog, t)}</td>
                  <td>{skill.agents.length > 0 ? skill.agents.join(", ") : t("installed.agentsEmpty")}</td>
                  <td>{skill.scope === "global" ? t("common.global") : t("common.project")}</td>
                  <td>{skill.updatedAt ? new Date(skill.updatedAt).toLocaleString() : t("common.none")}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-button" type="button" onClick={() => onUpdate(skill)} aria-label={t("common.update")}>
                        <Upload size={15} />
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => onRemove(skill)} aria-label={t("common.remove")}>
                        <Trash2 size={15} />
                      </button>
                      <CopyButton
                        t={t}
                        label={t("installed.copyCommand")}
                        value={() =>
                          `${formatCommand(
                            buildUpdateArgs({ skillName: skill.name, agents: skill.agents, scope: skill.scope }),
                          )}\n${formatCommand(buildRemoveArgs({ skillName: skill.name, agents: skill.agents, scope: skill.scope }))}`
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {skills.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <strong>{t("installed.emptyTitle")}</strong>
                      <span>{t("installed.emptyText")}</span>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-panel">
        <details>
          <summary>{t("common.rawOutput")}</summary>
          <pre className="code-block">{formatTerminalOutput(rawOutput, t("common.none"))}</pre>
        </details>
      </section>
    </div>
  );
}
