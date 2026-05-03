import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import type { AppUpdateInfo, AppUpdateProgress } from "../types";
import { requireTauriRuntime } from "./tauriRuntime";

export interface AppUpdateApi {
  getCurrentAppVersion(): Promise<string>;
  checkForAppUpdate(): Promise<AppUpdateInfo | null>;
  downloadAndInstallAppUpdate(onProgress: (progress: AppUpdateProgress) => void): Promise<void>;
  relaunchApp(): Promise<void>;
}

let pendingUpdate: Update | null = null;

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

export function createAppUpdateApi(): AppUpdateApi {
  return {
    async getCurrentAppVersion() {
      requireTauriRuntime("App version lookup");
      return getVersion();
    },
    async checkForAppUpdate() {
      requireTauriRuntime("App update checks");
      const update = await check();
      await pendingUpdate?.close();
      pendingUpdate = update;
      return update ? toUpdateInfo(update) : null;
    },
    async downloadAndInstallAppUpdate(onProgress) {
      requireTauriRuntime("App updates");
      let update = pendingUpdate;

      if (!update) {
        update = await check();
        pendingUpdate = update;
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

