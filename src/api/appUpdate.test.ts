import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { createAppUpdateApi } from "./appUpdate";

const downloadAndInstall = vi.fn();
const close = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

function stubTauriRuntime() {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
}

function mockUpdate(): Update {
  return {
    body: "Release notes",
    close,
    currentVersion: "0.1.1",
    date: "2026-05-03T00:00:00.000Z",
    downloadAndInstall,
    rawJson: {},
    version: "0.1.2",
  } as unknown as Update;
}

describe("createAppUpdateApi", () => {
  beforeEach(() => {
    vi.mocked(check).mockReset();
    downloadAndInstall.mockReset();
    close.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a friendly runtime error outside Tauri", async () => {
    await expect(createAppUpdateApi().checkForAppUpdate()).rejects.toThrow(
      "App update checks requires the Tauri desktop runtime",
    );
  });

  it("passes a normalized proxy when checking for updates", async () => {
    stubTauriRuntime();
    vi.mocked(check).mockResolvedValue(mockUpdate());

    await createAppUpdateApi().checkForAppUpdate("  http://127.0.0.1:7890  ");

    expect(check).toHaveBeenCalledWith({ proxy: "http://127.0.0.1:7890" });
  });

  it("checks again with the requested proxy when the download flow has no matching update", async () => {
    stubTauriRuntime();
    vi.mocked(check).mockResolvedValue(mockUpdate());

    await createAppUpdateApi().downloadAndInstallAppUpdate(vi.fn(), "http://127.0.0.1:7891");

    expect(check).toHaveBeenCalledWith({ proxy: "http://127.0.0.1:7891" });
    expect(downloadAndInstall).toHaveBeenCalledWith(expect.any(Function));
  });
});
