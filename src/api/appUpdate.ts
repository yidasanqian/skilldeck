import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import type { AppUpdateInfo, AppUpdateProgress } from "../types";
import { requireTauriRuntime } from "./tauriRuntime";

export interface AppUpdateApi {
  getCurrentAppVersion(): Promise<string>;
  checkForAppUpdate(proxy?: string): Promise<AppUpdateInfo | null>;
  downloadAndInstallAppUpdate(
    onProgress: (progress: AppUpdateProgress) => void,
    proxy?: string,
  ): Promise<void>;
  relaunchApp(): Promise<void>;
}

let pendingUpdate: Update | null = null;
let pendingUpdateProxy: string | undefined;

function toUpdateInfo(update: Update): AppUpdateInfo {
  return {
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    date: update.date,
    body: update.body,
    rawJson: update.rawJson,
  };
}

function updateProgressFromEvent(
  event: DownloadEvent,
  progress: AppUpdateProgress,
): AppUpdateProgress {
  if (event.event === "Started") {
    return {
      downloadedBytes: 0,
      contentLength: event.data.contentLength,
    };
  }

  if (event.event === "Progress") {
    return {
      ...progress,
      downloadedBytes: progress.downloadedBytes + event.data.chunkLength,
    };
  }

  return {
    ...progress,
    downloadedBytes: progress.contentLength ?? progress.downloadedBytes,
    finished: true,
  };
}

function updaterOptions(proxy?: string) {
  const normalizedProxy = proxy?.trim();
  return normalizedProxy ? { proxy: normalizedProxy } : undefined;
}

function normalizedProxy(proxy?: string) {
  return proxy?.trim() || undefined;
}

export function createAppUpdateApi(): AppUpdateApi {
  return {
    async getCurrentAppVersion() {
      requireTauriRuntime("App version lookup");
      return getVersion();
    },
    async checkForAppUpdate(proxy) {
      requireTauriRuntime("App update checks");
      const proxyUrl = normalizedProxy(proxy);
      const update = await check(updaterOptions(proxyUrl));
      await pendingUpdate?.close();
      pendingUpdate = update;
      pendingUpdateProxy = proxyUrl;
      return update ? toUpdateInfo(update) : null;
    },
    async downloadAndInstallAppUpdate(onProgress, proxy) {
      requireTauriRuntime("App updates");
      const proxyUrl = normalizedProxy(proxy);
      let update = pendingUpdate;

      if (!update || pendingUpdateProxy !== proxyUrl) {
        update = await check(updaterOptions(proxyUrl));
        pendingUpdate = update;
        pendingUpdateProxy = proxyUrl;
      }

      if (!update) {
        throw new Error("No app update is available.");
      }

      let progress: AppUpdateProgress = { downloadedBytes: 0 };
      await update.downloadAndInstall((event) => {
        progress = updateProgressFromEvent(event, progress);
        onProgress(progress);
      });
    },
    async relaunchApp() {
      requireTauriRuntime("App relaunch");
      await relaunch();
    },
  };
}
