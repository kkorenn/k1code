import { describe, expect, it } from "vitest";
import { detectInstallTargetOs, getProviderInstallGuide } from "./providerInstall";

describe("detectInstallTargetOs", () => {
  it("detects macOS from navigator platform values", () => {
    expect(detectInstallTargetOs("MacIntel")).toBe("macos");
  });

  it("detects Windows from navigator platform values", () => {
    expect(detectInstallTargetOs("Win32")).toBe("windows");
  });

  it("detects Linux from navigator platform values", () => {
    expect(detectInstallTargetOs("Linux x86_64")).toBe("linux");
  });

  it("falls back to unknown when platform is not recognized", () => {
    expect(detectInstallTargetOs("UnknownOS")).toBe("unknown");
  });
});

describe("getProviderInstallGuide", () => {
  it("includes macOS install + auth steps for codex", () => {
    const guide = getProviderInstallGuide("codex", "macos");

    expect(guide.providerLabel).toBe("Codex");
    expect(guide.steps[0]?.command).toBe("brew install codex");
    expect(guide.steps[1]?.command).toBe("codex --version");
    expect(guide.steps[2]?.command).toBe("codex login");
  });

  it("includes npm install command for OpenCode on Linux", () => {
    const guide = getProviderInstallGuide("openCode", "linux");

    expect(guide.steps[0]?.command).toBe("npm install -g opencode-ai");
    expect(guide.steps[2]?.command).toBe("opencode auth login");
  });

  it("falls back to docs-only install guidance when no command is defined", () => {
    const guide = getProviderInstallGuide("cursor", "windows");

    expect(guide.steps[0]?.command).toBeUndefined();
    expect(guide.steps[0]?.note).toContain("https://docs.cursor.com/en/cli/installation");
    expect(guide.steps[2]?.command).toBe("cursor-agent login");
  });
});
