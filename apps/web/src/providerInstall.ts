import { type ProviderKind } from "@k1tools/contracts";
import { isLinuxPlatform, isMacPlatform, isWindowsPlatform } from "~/lib/utils";

export type InstallTargetOs = "macos" | "windows" | "linux" | "unknown";

export interface ProviderInstallStep {
  title: string;
  command?: string;
  note?: string;
}

export interface ProviderInstallGuide {
  provider: ProviderKind;
  providerLabel: string;
  os: InstallTargetOs;
  osLabel: string;
  installUrl: string;
  steps: ReadonlyArray<ProviderInstallStep>;
}

const PROVIDER_LABEL_BY_KIND: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  gemini: "Gemini",
  cursor: "Cursor",
  openCode: "OpenCode",
};

const PROVIDER_INSTALL_URL_BY_KIND: Record<ProviderKind, string> = {
  codex: "https://github.com/openai/codex",
  claudeAgent: "https://docs.anthropic.com/en/docs/claude-code/setup",
  gemini: "https://github.com/google-gemini/gemini-cli",
  cursor: "https://docs.cursor.com/en/cli/installation",
  openCode: "https://opencode.ai/docs/cli/",
};

const PROVIDER_BINARY_BY_KIND: Record<ProviderKind, string> = {
  codex: "codex",
  claudeAgent: "claude",
  gemini: "gemini",
  cursor: "cursor-agent",
  openCode: "opencode",
};

const PROVIDER_LOGIN_COMMAND_BY_KIND: Record<ProviderKind, string> = {
  codex: "codex login",
  claudeAgent: "claude auth login",
  gemini: "gemini",
  cursor: "cursor-agent login",
  openCode: "opencode auth login",
};

const PROVIDER_LOGIN_NOTE_BY_KIND: Partial<Record<ProviderKind, string>> = {
  gemini: 'When prompted, choose "Sign in with Google" (or configure GEMINI_API_KEY), then retry.',
};

const PROVIDER_INSTALL_COMMAND_BY_KIND: Record<
  ProviderKind,
  Partial<Record<Exclude<InstallTargetOs, "unknown">, string>>
> = {
  codex: {
    macos: "brew install codex",
    windows: "npm install -g @openai/codex",
    linux: "npm install -g @openai/codex",
  },
  claudeAgent: {
    macos: "npm install -g @anthropic-ai/claude-code",
    windows: "npm install -g @anthropic-ai/claude-code",
    linux: "npm install -g @anthropic-ai/claude-code",
  },
  gemini: {
    macos: "npm install -g @google/gemini-cli",
    windows: "npm install -g @google/gemini-cli",
    linux: "npm install -g @google/gemini-cli",
  },
  cursor: {},
  openCode: {
    macos: "brew install sst/tap/opencode",
    windows: "npm install -g opencode-ai",
    linux: "npm install -g opencode-ai",
  },
};

function installOsLabel(os: InstallTargetOs): string {
  switch (os) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return "your OS";
  }
}

function installCommandForProvider(provider: ProviderKind, os: InstallTargetOs): string | null {
  if (os === "unknown") {
    return null;
  }

  const commands = PROVIDER_INSTALL_COMMAND_BY_KIND[provider];
  return commands[os] ?? null;
}

export function detectInstallTargetOs(platform?: string): InstallTargetOs {
  const platformValue =
    platform ??
    (typeof navigator !== "undefined" && typeof navigator.platform === "string"
      ? navigator.platform
      : "");

  if (isWindowsPlatform(platformValue)) {
    return "windows";
  }
  if (isMacPlatform(platformValue)) {
    return "macos";
  }
  if (isLinuxPlatform(platformValue)) {
    return "linux";
  }
  return "unknown";
}

export function getProviderInstallGuide(
  provider: ProviderKind,
  os: InstallTargetOs,
): ProviderInstallGuide {
  const providerLabel = PROVIDER_LABEL_BY_KIND[provider];
  const installUrl = PROVIDER_INSTALL_URL_BY_KIND[provider];
  const binary = PROVIDER_BINARY_BY_KIND[provider];
  const loginCommand = PROVIDER_LOGIN_COMMAND_BY_KIND[provider];
  const loginNote = PROVIDER_LOGIN_NOTE_BY_KIND[provider];
  const installCommand = installCommandForProvider(provider, os);

  const steps: ProviderInstallStep[] = [
    installCommand
      ? {
          title: `Install ${providerLabel} CLI (${installOsLabel(os)}).`,
          command: installCommand,
        }
      : {
          title: `Install ${providerLabel} CLI from the official docs (${installOsLabel(os)}).`,
          note: `Follow the provider setup guide: ${installUrl}`,
        },
    {
      title: `Verify ${binary} is available in your PATH.`,
      command: `${binary} --version`,
    },
    {
      title: `Authenticate ${providerLabel}.`,
      command: loginCommand,
      ...(loginNote ? { note: loginNote } : {}),
    },
  ];

  return {
    provider,
    providerLabel,
    os,
    osLabel: installOsLabel(os),
    installUrl,
    steps,
  };
}
