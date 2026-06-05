import type {
  AgentCatalogResponse,
  AgentMetadataResponse,
  CheckEnvironmentResponse,
  CommandResult,
  InstallDefaultsResponse,
  Scope,
  SkillInstallRequest,
  SkillRemoveRequest,
  SkillsFindResponse,
  SkillsListResponse,
  SkillsMutationResponse,
  SkillUpdateRequest,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { requireTauriRuntime } from "./tauriRuntime";

export interface SkillsApi {
  checkEnvironment(): Promise<CheckEnvironmentResponse>;
  skillsAgentMetadata(): Promise<AgentMetadataResponse>;
  skillsAgentCatalog(): Promise<AgentCatalogResponse>;
  skillsInstallDefaults(): Promise<InstallDefaultsResponse>;
  skillsFind(query: string): Promise<SkillsFindResponse>;
  skillsList(scope: Scope, agents: string[], projectPath?: string): Promise<SkillsListResponse>;
  skillsAdd(request: SkillInstallRequest): Promise<SkillsMutationResponse>;
  skillsRemove(request: SkillRemoveRequest): Promise<SkillsMutationResponse>;
  skillsUpdate(request: SkillUpdateRequest): Promise<SkillsMutationResponse>;
  checkSymlinkPaths(paths: string[]): Promise<string[]>;
  readSkillContent(path: string): Promise<string>;
}

function getNpxBinaryName() {
  return navigator.userAgent.includes("Windows") ? "npx.cmd" : "npx";
}

export function toAgentCliId(agent: string) {
  return agent.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

function isGitHubShorthandSource(source: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.trim());
}

function hasInlineSkillSelector(source: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/.test(source.trim());
}

function installSourceAndSkillFlags(source: string, skillNames: string[]) {
  const trimmedSource = source.trim();
  if (skillNames.length === 1 && isGitHubShorthandSource(trimmedSource)) {
    return {
      source: `${trimmedSource}@${skillNames[0]}`,
      skillNames: [],
    };
  }
  if (hasInlineSkillSelector(trimmedSource)) {
    return {
      source: trimmedSource,
      skillNames: [],
    };
  }
  return {
    source: trimmedSource,
    skillNames,
  };
}

function buildSkillsCommandArgs(args: string[]) {
  return ["--yes", "skills", ...args];
}

export function buildInstallArgs(request: SkillInstallRequest) {
  const installTarget = installSourceAndSkillFlags(request.source, request.skillNames);
  const args = buildSkillsCommandArgs(["add", installTarget.source]);

  installTarget.skillNames.forEach((skillName) => {
    args.push("--skill", skillName);
  });

  request.agents.forEach((agent) => {
    args.push("--agent", toAgentCliId(agent));
  });

  args.push(request.scope === "global" ? "-g" : "-p");
  args.push("-y");

  if (request.copy) {
    args.push("--copy");
  }

  return args;
}

export function buildRemoveArgs(request: SkillRemoveRequest) {
  const args = buildSkillsCommandArgs(["remove", request.skillName]);

  request.agents.forEach((agent) => {
    args.push("--agent", toAgentCliId(agent));
  });

  args.push(request.scope === "global" ? "-g" : "-p");
  args.push("-y");

  return args;
}

export function buildUpdateArgs(request: SkillUpdateRequest) {
  const args = buildSkillsCommandArgs(["update", request.skillName]);

  request.agents.forEach((agent) => {
    args.push("--agent", toAgentCliId(agent));
  });

  args.push(request.scope === "global" ? "-g" : "-p");
  args.push("-y");

  return args;
}

export function formatCommand(args: string[]) {
  return `${getNpxBinaryName()} ${args
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ")}`;
}

function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  requireTauriRuntime("SkillDeck CLI operations");
  return invoke<T>(command, args);
}

function createTauriSkillsApi(): SkillsApi {
  return {
    checkEnvironment() {
      return invokeTauri<CheckEnvironmentResponse>("check_environment");
    },
    skillsAgentMetadata() {
      return invokeTauri<AgentMetadataResponse>("skills_agent_metadata");
    },
    skillsAgentCatalog() {
      return invokeTauri<AgentCatalogResponse>("skills_agent_catalog");
    },
    skillsInstallDefaults() {
      return invokeTauri<InstallDefaultsResponse>("skills_install_defaults");
    },
    skillsFind(query) {
      return invokeTauri<SkillsFindResponse>("skills_find", { query });
    },
    skillsList(scope, agents, projectPath) {
      return invokeTauri<SkillsListResponse>("skills_list", { scope, agents, projectPath });
    },
    skillsAdd(request) {
      return invokeTauri<SkillsMutationResponse>("skills_add", { request });
    },
    skillsRemove(request) {
      return invokeTauri<SkillsMutationResponse>("skills_remove", { request });
    },
    skillsUpdate(request) {
      return invokeTauri<SkillsMutationResponse>("skills_update", { request });
    },
    checkSymlinkPaths(paths) {
      return invokeTauri<string[]>("check_symlink_paths", { paths });
    },
    readSkillContent(path) {
      return invokeTauri<string>("read_skill_content", { path });
    },
  };
}

export function createSkillsApi(): SkillsApi {
  return createTauriSkillsApi();
}
