declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

export function requireTauriRuntime(feature: string) {
  if (!isTauriRuntime()) {
    throw new Error(
      `${feature} requires the Tauri desktop runtime. Start SkillDeck with \`npm run tauri:dev\`.`,
    );
  }
}

