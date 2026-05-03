import { describe, expect, it } from "vitest";
import { buildInstallArgs, buildRemoveArgs, buildUpdateArgs, formatCommand } from "./skills";

describe("buildInstallArgs", () => {
  it("includes source, skill flags, and scope", () => {
    const args = buildInstallArgs({
      source: "anthropics/skills",
      skillNames: ["code-review"],
      agents: ["claude-code"],
      scope: "global",
      copy: false,
    });
    expect(args).toContain("add");
    expect(args).toContain("anthropics/skills");
    expect(args).toContain("--skill");
    expect(args).toContain("code-review");
    expect(args).toContain("--agent");
    expect(args).toContain("claude-code");
    expect(args).toContain("-g");
    expect(args).toContain("-y");
    expect(args).not.toContain("--copy");
  });

  it("uses -p for project scope", () => {
    const args = buildInstallArgs({
      source: "anthropics/skills",
      skillNames: ["x"],
      agents: [],
      scope: "project",
      copy: false,
    });
    expect(args).toContain("-p");
    expect(args).not.toContain("-g");
  });

  it("appends --copy when requested", () => {
    const args = buildInstallArgs({
      source: "anthropics/skills",
      skillNames: ["x"],
      agents: [],
      scope: "global",
      copy: true,
    });
    expect(args).toContain("--copy");
  });

  it("includes multiple --skill flags for multiple skill names", () => {
    const args = buildInstallArgs({
      source: "repo",
      skillNames: ["a", "b", "c"],
      agents: [],
      scope: "global",
      copy: false,
    });
    const skillIndices = args.reduce<number[]>((acc, a, i) => (a === "--skill" ? [...acc, i] : acc), []);
    expect(skillIndices).toHaveLength(3);
    expect(args[skillIndices[0] + 1]).toBe("a");
    expect(args[skillIndices[1] + 1]).toBe("b");
    expect(args[skillIndices[2] + 1]).toBe("c");
  });

  it("lowercases agent names", () => {
    const args = buildInstallArgs({
      source: "repo",
      skillNames: ["x"],
      agents: ["OpenClaw", "Claude-Code"],
      scope: "global",
      copy: false,
    });
    const agentIndices = args.reduce<number[]>((acc, a, i) => (a === "--agent" ? [...acc, i] : acc), []);
    expect(args[agentIndices[0] + 1]).toBe("openclaw");
    expect(args[agentIndices[1] + 1]).toBe("claude-code");
  });
});

describe("buildRemoveArgs", () => {
  it("produces correct base structure", () => {
    const args = buildRemoveArgs({ skillName: "my-skill", agents: [], scope: "global" });
    expect(args[0]).toBe("skills");
    expect(args[1]).toBe("remove");
    expect(args[2]).toBe("my-skill");
    expect(args).toContain("-g");
    expect(args).toContain("-y");
  });

  it("lowercases mixed-case agent names", () => {
    const args = buildRemoveArgs({
      skillName: "documentation-writer",
      agents: ["OpenClaw"],
      scope: "global",
    });
    const idx = args.indexOf("--agent");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("openclaw");
  });

  it("uses -p for project scope", () => {
    const args = buildRemoveArgs({ skillName: "x", agents: [], scope: "project" });
    expect(args).toContain("-p");
    expect(args).not.toContain("-g");
  });

  it("handles multiple agents", () => {
    const args = buildRemoveArgs({
      skillName: "x",
      agents: ["Alpha", "BETA"],
      scope: "global",
    });
    const agentIndices = args.reduce<number[]>((acc, a, i) => (a === "--agent" ? [...acc, i] : acc), []);
    expect(agentIndices).toHaveLength(2);
    expect(args[agentIndices[0] + 1]).toBe("alpha");
    expect(args[agentIndices[1] + 1]).toBe("beta");
  });
});

describe("buildUpdateArgs", () => {
  it("produces correct base structure", () => {
    const args = buildUpdateArgs({ skillName: "my-skill", agents: [], scope: "global" });
    expect(args[0]).toBe("skills");
    expect(args[1]).toBe("update");
    expect(args[2]).toBe("my-skill");
    expect(args).toContain("-g");
    expect(args).toContain("-y");
  });

  it("lowercases agent names", () => {
    const args = buildUpdateArgs({ skillName: "x", agents: ["OpenClaw"], scope: "global" });
    const idx = args.indexOf("--agent");
    expect(args[idx + 1]).toBe("openclaw");
  });

  it("uses -p for project scope", () => {
    const args = buildUpdateArgs({ skillName: "x", agents: [], scope: "project" });
    expect(args).toContain("-p");
  });
});

describe("formatCommand", () => {
  it("joins args with spaces", () => {
    expect(formatCommand(["skills", "list", "-g"])).toMatch(/skills list -g/);
  });

  it("quotes args that contain spaces", () => {
    expect(formatCommand(["skills", "add", "my org/repo"])).toContain('"my org/repo"');
  });

  it("does not quote args without spaces", () => {
    const result = formatCommand(["skills", "remove", "my-skill"]);
    expect(result).not.toContain('"my-skill"');
  });
});
