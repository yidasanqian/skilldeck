import { describe, expect, it } from "vitest";
import { createAppUpdateApi } from "./appUpdate";

describe("createAppUpdateApi", () => {
  it("returns a friendly runtime error outside Tauri", async () => {
    await expect(createAppUpdateApi().checkForAppUpdate()).rejects.toThrow(
      "App update checks requires the Tauri desktop runtime",
    );
  });
});

