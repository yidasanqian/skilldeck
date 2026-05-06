import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { createAppUpdateApi } from "./api/appUpdate";
import { buildInstallArgs, buildRemoveArgs, buildUpdateArgs, createSkillsApi } from "./api/skills";
import { AppShell } from "./components/AppShell";
import { CommandLog, type CommandLogFocus } from "./components/CommandLog";
import { ConfirmDialog, type ConfirmDialogState } from "./components/ConfirmDialog";
import { createTranslator, getInitialLocale, persistLocale } from "./i18n";
import type {
  AgentCatalogResponse,
  AppUpdateState,
  CommandOutputEvent,
  CommandResult,
  EnvironmentStatus,
  InstallDefaultsResponse,
  InstallDraft,
  Locale,
  Scope,
  SkillInstallRequest,
  SkillRecord,
  UserSettings,
  ViewId,
} from "./types";
import { DashboardView } from "./views/DashboardView";
import { InstalledView } from "./views/InstalledView";
import { InstallView } from "./views/InstallView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";

const SETTINGS_STORAGE_KEY = "skilldeck:settings";
const PROJECT_PATH_STORAGE_KEY = "skilldeck:lastProjectPath";

const defaultSettings: UserSettings = {
  defaultScope: "global",
};

const initialEnvironment: EnvironmentStatus = {
  overall: "checking",
  node: { name: "Node", ok: false, detail: "..." },
  npx: { name: "npx", ok: false, detail: "..." },
  skills: { name: "skills CLI", ok: false, detail: "..." },
  pathPreview: [],
};

const initialAgentCatalog: AgentCatalogResponse = {
  agents: [],
  coreDefaultAgents: [],
};

const initialInstallDefaults: InstallDefaultsResponse = {
  defaultAgents: [],
  lastSelectedAgents: [],
  detectedAgents: [],
  needsAgentSelection: true,
  defaultScope: "project",
  defaultCopy: false,
};

const initialAppUpdateState: AppUpdateState = {
  phase: "idle",
  downloadedBytes: 0,
};

function loadSettings(): UserSettings {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return defaultSettings;
    const parsed = JSON.parse(stored) as Partial<UserSettings>;
    return {
      ...defaultSettings,
      ...parsed,
    };
  } catch {
    return defaultSettings;
  }
}

function persistSettings(settings: UserSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function isAgentCatalogLoaded(catalog: AgentCatalogResponse) {
  return Boolean(catalog.packagePath || catalog.version || catalog.error || catalog.agents.length > 0);
}

function loadLastProjectPath() {
  return window.localStorage.getItem(PROJECT_PATH_STORAGE_KEY) ?? "";
}

function persistLastProjectPath(path: string) {
  window.localStorage.setItem(PROJECT_PATH_STORAGE_KEY, path);
}

function createPendingCommand(args: string[]): CommandResult {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    status: "pending",
    command: navigator.userAgent.includes("Windows") ? "npx.cmd" : "npx",
    args,
    startedAt: new Date().toISOString(),
    stdout: "",
    stderr: "",
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTauriRuntimeError(message: string) {
  return message.includes("Tauri desktop runtime");
}

export default function App() {
  const api = useMemo(() => createSkillsApi(), []);
  const appUpdateApi = useMemo(() => createAppUpdateApi(), []);
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [settings, setSettingsState] = useState<UserSettings>(() => loadSettings());
  const [environment, setEnvironment] = useState<EnvironmentStatus>(initialEnvironment);
  const [checkingEnvironment, setCheckingEnvironment] = useState(false);
  const [commands, setCommands] = useState<CommandResult[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logFocus, setLogFocus] = useState<CommandLogFocus | null>(null);
  const [installedSkills, setInstalledSkills] = useState<SkillRecord[]>([]);
  const [installedRawOutput, setInstalledRawOutput] = useState("");
  const [installedParsed, setInstalledParsed] = useState(true);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogResponse>(initialAgentCatalog);
  const [installDefaults, setInstallDefaults] = useState<InstallDefaultsResponse>(initialInstallDefaults);
  const [agentMetadataLoading, setAgentMetadataLoading] = useState(false);
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>(initialAppUpdateState);
  const installedRequestId = useRef(0);
  const updateProxyUrlRef = useRef<string | undefined>(settings.updateProxyUrl?.trim() || undefined);

  const appendCommand = useCallback((command: CommandResult) => {
    setCommands((current) => [command, ...current].slice(0, 80));
  }, []);

  const replaceCommand = useCallback((pendingId: string, command: CommandResult) => {
    setCommands((current) => [command, ...current.filter((item) => item.id !== pendingId)].slice(0, 80));
  }, []);

  const appendCommandOutput = useCallback((event: CommandOutputEvent) => {
    setCommands((current) =>
      current.map((command) => {
        if (command.id !== event.commandId) return command;
        const key = event.stream;
        return {
          ...command,
          [key]: `${command[key]}${event.chunk}`,
        };
      }),
    );
  }, []);

  const checkEnvironment = useCallback(async () => {
    setCheckingEnvironment(true);
    setEnvironment((current) => ({ ...current, overall: "checking" }));
    try {
      const response = await api.checkEnvironment();
      setEnvironment(response.environment);
      appendCommand(response.command);
    } finally {
      setCheckingEnvironment(false);
    }
  }, [api, appendCommand]);

  const loadAgentMetadata = useCallback(async () => {
    setAgentMetadataLoading(true);
    try {
      let catalogResponse: AgentCatalogResponse;
      let defaultsResponse: InstallDefaultsResponse;

      try {
        const response = await api.skillsAgentMetadata();
        catalogResponse = response.catalog;
        defaultsResponse = response.installDefaults;

        if (!isAgentCatalogLoaded(catalogResponse)) {
          throw new Error("agent metadata returned an empty catalog");
        }
      } catch (error) {
        try {
          [catalogResponse, defaultsResponse] = await Promise.all([
            api.skillsAgentCatalog(),
            api.skillsInstallDefaults(),
          ]);
        } catch (fallbackError) {
          const message = fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : String(fallbackError);
          setAgentCatalog({
            agents: [],
            coreDefaultAgents: [],
            error: message,
          });
          setInstallDefaults(initialInstallDefaults);
          return;
        }
      }

      setAgentCatalog(catalogResponse);
      setInstallDefaults(defaultsResponse);
    } finally {
      setAgentMetadataLoading(false);
    }
  }, [api]);

  const loadInstalled = useCallback(
    async (scope: Scope, agents: string[] = [], projectPath?: string) => {
      const requestId = installedRequestId.current + 1;
      installedRequestId.current = requestId;
      setInstalledLoading(true);
      try {
        const response = await api.skillsList(scope, agents, projectPath);
        if (requestId !== installedRequestId.current) return;
        setInstalledSkills(response.skills);
        setInstalledRawOutput(response.rawOutput);
        setInstalledParsed(response.parsed);
        appendCommand(response.command);
      } finally {
        if (requestId === installedRequestId.current) {
          setInstalledLoading(false);
        }
      }
    },
    [api, appendCommand],
  );

  const refreshInstalled = useCallback(
    (scope: Scope, projectPath?: string) => {
      const resolvedProjectPath = projectPath?.trim() || loadLastProjectPath() || undefined;
      void loadInstalled(scope, [], scope === "project" ? resolvedProjectPath : undefined);
    },
    [loadInstalled],
  );

  const updateInstalledProjectPath = useCallback((projectPath: string) => {
    persistLastProjectPath(projectPath.trim());
  }, []);

  const checkPaths = useCallback(
    (paths: string[]) => api.checkSymlinkPaths(paths),
    [api],
  );

  const checkAppUpdate = useCallback(async () => {
    const checkedAt = new Date().toISOString();
    setAppUpdate((current) => ({
      ...current,
      phase: "checking",
      checkedAt,
      error: undefined,
      downloadedBytes: 0,
      contentLength: undefined,
    }));

    try {
      const currentVersion = await appUpdateApi.getCurrentAppVersion();
      const update = await appUpdateApi.checkForAppUpdate(updateProxyUrlRef.current);
      setAppUpdate({
        phase: update ? "available" : "upToDate",
        currentVersion: update?.currentVersion ?? currentVersion,
        checkedAt,
        info: update ?? undefined,
        downloadedBytes: 0,
      });
    } catch (error) {
      const message = errorMessage(error);
      setAppUpdate((current) => ({
        ...current,
        phase: isTauriRuntimeError(message) ? "unsupported" : "error",
        checkedAt,
        error: message,
        downloadedBytes: 0,
        contentLength: undefined,
      }));
    }
  }, [appUpdateApi]);

  const downloadAppUpdate = useCallback(async () => {
    setAppUpdate((current) => ({
      ...current,
      phase: "downloading",
      error: undefined,
      downloadedBytes: 0,
      contentLength: undefined,
    }));

    try {
      await appUpdateApi.downloadAndInstallAppUpdate(
        (progress) => {
          setAppUpdate((current) => ({
            ...current,
            downloadedBytes: progress.downloadedBytes,
            contentLength: progress.contentLength,
          }));
        },
        updateProxyUrlRef.current,
      );
      setAppUpdate((current) => ({
        ...current,
        phase: "readyToRelaunch",
        error: undefined,
      }));
    } catch (error) {
      setAppUpdate((current) => ({
        ...current,
        phase: "error",
        error: errorMessage(error),
      }));
    }
  }, [appUpdateApi]);

  const relaunchApp = useCallback(async () => {
    try {
      await appUpdateApi.relaunchApp();
    } catch (error) {
      setAppUpdate((current) => ({
        ...current,
        phase: "error",
        error: errorMessage(error),
      }));
    }
  }, [appUpdateApi]);

  useEffect(() => {
    document.documentElement.lang = locale.split("-")[0];
    persistLocale(locale);
  }, [locale]);

  useEffect(() => {
    updateProxyUrlRef.current = settings.updateProxyUrl?.trim() || undefined;
  }, [settings.updateProxyUrl]);

  useEffect(() => {
    void (async () => {
      await checkEnvironment();
      await loadAgentMetadata();
    })();
  }, [checkEnvironment, loadAgentMetadata]);

  useEffect(() => {
    void checkAppUpdate();
  }, [checkAppUpdate]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<CommandOutputEvent>("skilldeck://command-output", (event) => {
      appendCommandOutput(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, [appendCommandOutput]);

  function setLocale(localeValue: Locale) {
    setLocaleState(localeValue);
  }

  function setSettings(next: UserSettings) {
    setSettingsState(next);
    persistSettings(next);
  }

  function closeConfirm() {
    if (!mutationBusy) {
      setConfirmState(null);
    }
  }

  function requestInstall(request: SkillInstallRequest) {
    const args = buildInstallArgs(request);
    setConfirmState({
      title: t("confirm.installTitle"),
      confirmLabel: t("confirm.executeInstall"),
      rows: [
        { label: t("common.source"), value: request.source },
        { label: t("common.skills"), value: request.skillNames.join(", ") },
        { label: t("common.agent"), value: request.agents.join(", ") || t("common.none") },
        { label: t("common.scope"), value: request.scope === "global" ? t("common.global") : t("common.project") },
        ...(request.scope === "project"
          ? [{ label: t("install.projectPath"), value: request.projectPath || t("common.none") }]
          : []),
        { label: t("common.copy"), value: request.copy ? "--copy" : t("install.symlinkOrDefault") },
      ],
      args,
      onConfirm: async () => {
        const pendingCommand = createPendingCommand(args);
        appendCommand(pendingCommand);
        setLogFocus({ commandId: pendingCommand.id, filter: "add" });
        setLogOpen(true);
        setMutationBusy(true);
        setConfirmState(null);
        try {
          const response = await api.skillsAdd({ ...request, commandId: pendingCommand.id });
          replaceCommand(pendingCommand.id, response.command);
          await loadInstalled(request.scope, [], request.projectPath);
        } finally {
          setMutationBusy(false);
        }
      },
    });
  }

  function requestRemove(skill: SkillRecord) {
    const request = { skillName: skill.name, agents: skill.agents, scope: skill.scope };
    const args = buildRemoveArgs(request);
    setConfirmState({
      title: t("confirm.removeTitle"),
      confirmLabel: t("confirm.executeRemove"),
      danger: true,
      rows: [
        { label: t("common.skill"), value: skill.name },
        { label: t("common.agent"), value: skill.agents.join(", ") || t("common.none") },
        { label: t("common.scope"), value: skill.scope === "global" ? t("common.global") : t("common.project") },
      ],
      args,
      onConfirm: async () => {
        const pendingCommand = createPendingCommand(args);
        appendCommand(pendingCommand);
        setLogFocus({ commandId: pendingCommand.id, filter: "remove" });
        setLogOpen(true);
        setMutationBusy(true);
        setConfirmState(null);
        try {
          const response = await api.skillsRemove({ ...request, commandId: pendingCommand.id });
          replaceCommand(pendingCommand.id, response.command);
          await loadInstalled(skill.scope);
        } finally {
          setMutationBusy(false);
        }
      },
    });
  }

  function requestUpdate(skill: SkillRecord) {
    const request = { skillName: skill.name, agents: skill.agents, scope: skill.scope };
    const args = buildUpdateArgs(request);
    setConfirmState({
      title: t("confirm.updateTitle"),
      confirmLabel: t("confirm.executeUpdate"),
      rows: [
        { label: t("common.skill"), value: skill.name },
        { label: t("common.agent"), value: skill.agents.join(", ") || t("common.none") },
        { label: t("common.scope"), value: skill.scope === "global" ? t("common.global") : t("common.project") },
      ],
      args,
      onConfirm: async () => {
        const pendingCommand = createPendingCommand(args);
        appendCommand(pendingCommand);
        setLogFocus({ commandId: pendingCommand.id, filter: "update" });
        setLogOpen(true);
        setMutationBusy(true);
        setConfirmState(null);
        try {
          const response = await api.skillsUpdate({ ...request, commandId: pendingCommand.id });
          replaceCommand(pendingCommand.id, response.command);
          await loadInstalled(skill.scope);
        } finally {
          setMutationBusy(false);
        }
      },
    });
  }

  const canMutate = environment.overall === "ready";

  function prepareInstall(draft: InstallDraft) {
    setInstallDraft(draft);
    setActiveView("install");
  }

  return (
    <>
      <AppShell
        activeView={activeView}
        environment={environment.overall}
        locale={locale}
        agentCatalog={agentCatalog}
        agentMetadataLoading={agentMetadataLoading}
        appUpdate={appUpdate}
        logOpen={logOpen}
        t={t}
        onNavigate={setActiveView}
        onLocaleChange={setLocale}
        onToggleLog={() => setLogOpen((current) => !current)}
      >
        <div style={activeView !== "dashboard" ? { display: "none" } : undefined}>
          <DashboardView
            environment={environment}
            installedCount={installedSkills.length}
            checking={checkingEnvironment}
            agentCatalog={agentCatalog}
            installDefaults={installDefaults}
            agentMetadataLoading={agentMetadataLoading}
            recentCommands={commands}
            t={t}
            onRecheck={() => void checkEnvironment()}
            onReloadAgents={() => void loadAgentMetadata()}
            onNavigate={setActiveView}
          />
        </div>

        <div style={activeView !== "search" ? { display: "none" } : undefined}>
          <SearchView
            api={api}
            canMutate={canMutate}
            t={t}
            onCommand={appendCommand}
            onPrepareInstall={prepareInstall}
          />
        </div>

        <div style={activeView !== "installed" ? { display: "none" } : undefined}>
          <InstalledView
            skills={installedSkills}
            rawOutput={installedRawOutput}
            loading={installedLoading}
            parsed={installedParsed}
            defaultScope={settings.defaultScope}
            defaultProjectPath={loadLastProjectPath()}
            agentCatalog={agentCatalog}
            t={t}
            onProjectPathChange={updateInstalledProjectPath}
            onRefresh={refreshInstalled}
            onCheckPaths={checkPaths}
            onRemove={requestRemove}
            onUpdate={requestUpdate}
          />
        </div>

        <div style={activeView !== "install" ? { display: "none" } : undefined}>
          <InstallView
            draft={installDraft}
            agentCatalog={agentCatalog}
            installDefaults={installDefaults}
            agentMetadataLoading={agentMetadataLoading}
            canMutate={canMutate}
            t={t}
            onReloadAgents={() => void loadAgentMetadata()}
            onInstall={requestInstall}
          />
        </div>

        <div style={activeView !== "settings" ? { display: "none" } : undefined}>
          <SettingsView
            locale={locale}
            settings={settings}
            agentCatalog={agentCatalog}
            agentMetadataLoading={agentMetadataLoading}
            appUpdate={appUpdate}
            t={t}
            onLocaleChange={setLocale}
            onSettingsChange={setSettings}
            onReloadAgents={() => void loadAgentMetadata()}
            onCheckAppUpdate={() => void checkAppUpdate()}
            onDownloadAppUpdate={() => void downloadAppUpdate()}
            onRelaunchApp={() => void relaunchApp()}
          />
        </div>
      </AppShell>

      <CommandLog
        commands={commands}
        open={logOpen}
        focus={logFocus}
        t={t}
        onToggle={() => setLogOpen((current) => !current)}
      />
      <ConfirmDialog state={confirmState} t={t} busy={mutationBusy} onClose={closeConfirm} />
    </>
  );
}
