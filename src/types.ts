export type Locale = "zh-CN" | "en-US";

export type ViewId = "dashboard" | "search" | "installed" | "install" | "settings";

export type Scope = "global" | "project";

export type CommandStatus = "pending" | "success" | "failed" | "timeout";

export type EnvironmentOverall = "checking" | "ready" | "partial" | "missing";

export interface UserSettings {
  defaultScope: Scope;
}

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "readyToRelaunch"
  | "error"
  | "unsupported";

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  date?: string;
  body?: string;
  rawJson?: Record<string, unknown>;
}

export interface AppUpdateProgress {
  downloadedBytes: number;
  contentLength?: number;
  finished?: boolean;
}

export interface AppUpdateState {
  phase: AppUpdatePhase;
  currentVersion?: string;
  checkedAt?: string;
  info?: AppUpdateInfo;
  downloadedBytes: number;
  contentLength?: number;
  error?: string;
}

export interface InstallDraft {
  source: string;
  skillNames: string[];
}

export interface EnvironmentCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface EnvironmentStatus {
  overall: EnvironmentOverall;
  node: EnvironmentCheck;
  npx: EnvironmentCheck;
  skills: EnvironmentCheck;
  pathPreview: string[];
  version?: string;
  checkedAt?: string;
}

export interface CommandResult {
  id: string;
  status: CommandStatus;
  command: string;
  args: string[];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface SkillSearchResult {
  id: string;
  name: string;
  source: string;
  description: string;
  tags?: string[];
  installHint?: string;
  rawLine: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  source: string;
  description?: string;
  agents: string[];
  scope: Scope;
  updatedAt?: string;
}

export interface SkillInstallRequest {
  source: string;
  skillNames: string[];
  agents: string[];
  scope: Scope;
  projectPath?: string;
  commandId?: string;
  copy: boolean;
}

export interface CommandOutputEvent {
  commandId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface SkillRemoveRequest {
  skillName: string;
  agents: string[];
  scope: Scope;
  commandId?: string;
}

export interface SkillUpdateRequest {
  skillName: string;
  agents: string[];
  scope: Scope;
  commandId?: string;
}

export type AgentDetectionStatus = "detected" | "missing" | "unknown";

export interface AgentInfo {
  id: string;
  displayName: string;
  projectSkillsDir: string;
  globalSkillsDir?: string;
  isUniversal: boolean;
  hidden: boolean;
  detectionStatus: AgentDetectionStatus;
  detectionPaths: string[];
}

export interface AgentCatalogResponse {
  agents: AgentInfo[];
  packagePath?: string;
  version?: string;
  coreDefaultAgents: string[];
  error?: string;
}

export interface InstallDefaultsResponse {
  defaultAgents: string[];
  lastSelectedAgents: string[];
  detectedAgents: string[];
  needsAgentSelection: boolean;
  defaultScope: Scope;
  defaultCopy: boolean;
  error?: string;
}

export interface AgentMetadataResponse {
  catalog: AgentCatalogResponse;
  installDefaults: InstallDefaultsResponse;
}

export interface CheckEnvironmentResponse {
  environment: EnvironmentStatus;
  command: CommandResult;
}

export interface SkillsFindResponse {
  results: SkillSearchResult[];
  rawOutput: string;
  command: CommandResult;
}

export interface SkillsListResponse {
  skills: SkillRecord[];
  rawOutput: string;
  parsed: boolean;
  command: CommandResult;
}

export interface SkillsMutationResponse {
  affected: SkillRecord[];
  command: CommandResult;
}
