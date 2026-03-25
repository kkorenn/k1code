import { useCallback } from "react";
import { Option, Schema } from "effect";
import {
  type ServerProviderStatus,
  TrimmedNonEmptyString,
  type ProviderKind,
  type ProviderModelOption,
  type ProviderModelOptionsByProvider,
  type ProviderStartOptions,
} from "@k1tools/contracts";
import {
  formatModelDisplayName,
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@k1tools/shared/model";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { EnvMode } from "./components/BranchToolbar.logic";

const APP_SETTINGS_STORAGE_KEY = "k1code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const MAX_FONT_FAMILY_LENGTH = 256;

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";
export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";
export const UiFontSize = Schema.Literals(["sm", "md", "lg"]);
export type UiFontSize = typeof UiFontSize.Type;
export const DEFAULT_UI_FONT_SIZE: UiFontSize = "md";

export const TerminalFontSize = Schema.Literals(["sm", "md", "lg", "xl"]);
export type TerminalFontSize = typeof TerminalFontSize.Type;
export const DEFAULT_TERMINAL_FONT_SIZE: TerminalFontSize = "md";
export const DeveloperProviderAvailabilityOverride = Schema.Literals([
  "auto",
  "available",
  "unavailable",
]);
export type DeveloperProviderAvailabilityOverride =
  typeof DeveloperProviderAvailabilityOverride.Type;
type CustomModelSettingsKey =
  | "customCodexModels"
  | "customClaudeModels"
  | "customGeminiModels"
  | "customCursorModels"
  | "customCopilotModels"
  | "customOpenCodeModels";
type ProviderAvailabilityOverrideSettingsKey =
  | "developerProviderAvailabilityCodex"
  | "developerProviderAvailabilityClaude"
  | "developerProviderAvailabilityGemini"
  | "developerProviderAvailabilityCursor"
  | "developerProviderAvailabilityCopilot"
  | "developerProviderAvailabilityOpenCode";
export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  settingsKey: CustomModelSettingsKey;
  defaultSettingsKey: CustomModelSettingsKey;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
  gemini: new Set(getModelOptions("gemini").map((option) => option.slug)),
  cursor: new Set(getModelOptions("cursor").map((option) => option.slug)),
  copilot: new Set(getModelOptions("copilot").map((option) => option.slug)),
  openCode: new Set(getModelOptions("openCode").map((option) => option.slug)),
};

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

export const AppSettingsSchema = Schema.Struct({
  claudeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  geminiBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  cursorBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  copilotBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  copilotConfigDir: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  openCodeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  newProjectBasePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),
  diffWordWrap: Schema.Boolean.pipe(withDefaults(() => false)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: TimestampFormat.pipe(withDefaults(() => DEFAULT_TIMESTAMP_FORMAT)),
  uiFontSize: UiFontSize.pipe(withDefaults(() => DEFAULT_UI_FONT_SIZE)),
  terminalFontSize: TerminalFontSize.pipe(withDefaults(() => DEFAULT_TERMINAL_FONT_SIZE)),
  uiFontFamily: Schema.String.check(Schema.isMaxLength(MAX_FONT_FAMILY_LENGTH)).pipe(
    withDefaults(() => ""),
  ),
  monoFontFamily: Schema.String.check(Schema.isMaxLength(MAX_FONT_FAMILY_LENGTH)).pipe(
    withDefaults(() => ""),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customClaudeModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customGeminiModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customCursorModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customCopilotModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customOpenCodeModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  textGenerationProvider: Schema.Literals([
    "codex",
    "claudeAgent",
    "gemini",
    "cursor",
    "copilot",
    "openCode",
  ]).pipe(withDefaults(() => "codex" as const)),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
  developerModeEnabled: Schema.Boolean.pipe(withDefaults(() => false)),
  developerProviderAvailabilityCodex: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
  developerProviderAvailabilityClaude: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
  developerProviderAvailabilityGemini: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
  developerProviderAvailabilityCursor: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
  developerProviderAvailabilityCopilot: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
  developerProviderAvailabilityOpenCode: DeveloperProviderAvailabilityOverride.pipe(
    withDefaults(() => "auto" as const satisfies DeveloperProviderAvailabilityOverride),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

type ProviderModelList = ReadonlyArray<ProviderModelOption>;

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});
const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    settingsKey: "customCodexModels",
    defaultSettingsKey: "customCodexModels",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    settingsKey: "customClaudeModels",
    defaultSettingsKey: "customClaudeModels",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
  gemini: {
    provider: "gemini",
    settingsKey: "customGeminiModels",
    defaultSettingsKey: "customGeminiModels",
    title: "Gemini",
    description: "Save additional Gemini model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-2.5-flash-lite-preview",
  },
  cursor: {
    provider: "cursor",
    settingsKey: "customCursorModels",
    defaultSettingsKey: "customCursorModels",
    title: "Cursor",
    description: "Save additional Cursor model slugs for the picker and `/model` command.",
    placeholder: "your-cursor-model-slug",
    example: "claude-4.5-sonnet",
  },
  copilot: {
    provider: "copilot",
    settingsKey: "customCopilotModels",
    defaultSettingsKey: "customCopilotModels",
    title: "Copilot",
    description: "Save additional Copilot model slugs for the picker and `/model` command.",
    placeholder: "your-copilot-model-slug",
    example: "gpt-5.4-mini",
  },
  openCode: {
    provider: "openCode",
    settingsKey: "customOpenCodeModels",
    defaultSettingsKey: "customOpenCodeModels",
    title: "OpenCode",
    description: "Save additional OpenCode model slugs for the picker and `/model` command.",
    placeholder: "your-opencode-model-slug",
    example: "openai/gpt-5.4",
  },
};
export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);
const ALL_PROVIDER_KINDS: ReadonlyArray<ProviderKind> = [
  "codex",
  "claudeAgent",
  "gemini",
  "cursor",
  "copilot",
  "openCode",
];
const PROVIDER_AVAILABILITY_OVERRIDE_SETTING_KEY: Record<
  ProviderKind,
  ProviderAvailabilityOverrideSettingsKey
> = {
  codex: "developerProviderAvailabilityCodex",
  claudeAgent: "developerProviderAvailabilityClaude",
  gemini: "developerProviderAvailabilityGemini",
  cursor: "developerProviderAvailabilityCursor",
  copilot: "developerProviderAvailabilityCopilot",
  openCode: "developerProviderAvailabilityOpenCode",
};

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeAgent"),
    customGeminiModels: normalizeCustomModelSlugs(settings.customGeminiModels, "gemini"),
    customCursorModels: normalizeCustomModelSlugs(settings.customCursorModels, "cursor"),
    customCopilotModels: normalizeCustomModelSlugs(settings.customCopilotModels, "copilot"),
    customOpenCodeModels: normalizeCustomModelSlugs(settings.customOpenCodeModels, "openCode"),
  };
}

export function getCustomModelsForProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return settings[PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey];
}

export function getDefaultCustomModelsForProvider(
  defaults: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return defaults[PROVIDER_CUSTOM_MODEL_CONFIG[provider].defaultSettingsKey];
}

export function patchCustomModels(
  provider: ProviderKind,
  models: string[],
): Partial<Pick<AppSettings, CustomModelSettingsKey>> {
  return {
    [PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey]: models,
  };
}

export function getCustomModelsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, readonly string[]> {
  return {
    codex: getCustomModelsForProvider(settings, "codex"),
    claudeAgent: getCustomModelsForProvider(settings, "claudeAgent"),
    gemini: getCustomModelsForProvider(settings, "gemini"),
    cursor: getCustomModelsForProvider(settings, "cursor"),
    copilot: getCustomModelsForProvider(settings, "copilot"),
    openCode: getCustomModelsForProvider(settings, "openCode"),
  };
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
  discoveredModels?: ProviderModelList,
): AppModelOption[] {
  const baseModels =
    discoveredModels && discoveredModels.length > 0 ? discoveredModels : getModelOptions(provider);
  const options: AppModelOption[] = baseModels.map(({ slug }) => ({
    slug,
    name: formatModelDisplayName(slug),
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: formatModelDisplayName(slug),
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingOption =
    resolveSelectableModel(provider, selectedModel, options) !== null;
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingOption
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: formatModelDisplayName(normalizedSelectedModel),
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
  discoveredModelsByProvider?: ProviderModelOptionsByProvider,
): string {
  const customModelsForProvider = customModels[provider];
  const options = getAppModelOptions(
    provider,
    customModelsForProvider,
    selectedModel,
    discoveredModelsByProvider?.[provider],
  );
  return resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider);
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
  discoveredModelsByProvider?: ProviderModelOptionsByProvider,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions(
      "codex",
      customModelsByProvider.codex,
      undefined,
      discoveredModelsByProvider?.codex,
    ),
    claudeAgent: getAppModelOptions(
      "claudeAgent",
      customModelsByProvider.claudeAgent,
      undefined,
      discoveredModelsByProvider?.claudeAgent,
    ),
    gemini: getAppModelOptions(
      "gemini",
      customModelsByProvider.gemini,
      undefined,
      discoveredModelsByProvider?.gemini,
    ),
    cursor: getAppModelOptions(
      "cursor",
      customModelsByProvider.cursor,
      undefined,
      discoveredModelsByProvider?.cursor,
    ),
    copilot: getAppModelOptions(
      "copilot",
      customModelsByProvider.copilot,
      undefined,
      discoveredModelsByProvider?.copilot,
    ),
    openCode: getAppModelOptions(
      "openCode",
      customModelsByProvider.openCode,
      undefined,
      discoveredModelsByProvider?.openCode,
    ),
  };
}

export function getProviderStartOptions(
  settings: Pick<
    AppSettings,
    | "claudeBinaryPath"
    | "codexBinaryPath"
    | "codexHomePath"
    | "geminiBinaryPath"
    | "cursorBinaryPath"
    | "copilotBinaryPath"
    | "copilotConfigDir"
    | "openCodeBinaryPath"
  >,
): ProviderStartOptions | undefined {
  const providerOptions: ProviderStartOptions = {
    ...(settings.codexBinaryPath || settings.codexHomePath
      ? {
          codex: {
            ...(settings.codexBinaryPath ? { binaryPath: settings.codexBinaryPath } : {}),
            ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
          },
        }
      : {}),
    ...(settings.claudeBinaryPath
      ? {
          claudeAgent: {
            binaryPath: settings.claudeBinaryPath,
          },
        }
      : {}),
    ...(settings.geminiBinaryPath
      ? {
          gemini: {
            binaryPath: settings.geminiBinaryPath,
          },
        }
      : {}),
    ...(settings.cursorBinaryPath
      ? {
          cursor: {
            binaryPath: settings.cursorBinaryPath,
          },
        }
      : {}),
    ...(settings.copilotBinaryPath || settings.copilotConfigDir
      ? {
          copilot: {
            ...(settings.copilotBinaryPath ? { binaryPath: settings.copilotBinaryPath } : {}),
            ...(settings.copilotConfigDir ? { configDir: settings.copilotConfigDir } : {}),
          },
        }
      : {}),
    ...(settings.openCodeBinaryPath
      ? {
          openCode: {
            binaryPath: settings.openCodeBinaryPath,
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

export function getProviderAvailabilityByProvider(
  settings: Pick<
    AppSettings,
    | "developerModeEnabled"
    | "developerProviderAvailabilityCodex"
    | "developerProviderAvailabilityClaude"
    | "developerProviderAvailabilityGemini"
    | "developerProviderAvailabilityCursor"
    | "developerProviderAvailabilityCopilot"
    | "developerProviderAvailabilityOpenCode"
  >,
  statuses: ReadonlyArray<Pick<ServerProviderStatus, "provider" | "available">>,
): Record<ProviderKind, boolean> {
  const statusByProvider = new Map<ProviderKind, boolean>(
    statuses.map((status) => [status.provider, status.available]),
  );

  return Object.fromEntries(
    ALL_PROVIDER_KINDS.map((provider) => {
      const statusAvailability = statusByProvider.get(provider) ?? true;
      if (!settings.developerModeEnabled) {
        return [provider, statusAvailability];
      }

      const override = settings[PROVIDER_AVAILABILITY_OVERRIDE_SETTING_KEY[provider]];
      if (override === "available") {
        return [provider, true];
      }
      if (override === "unavailable") {
        return [provider, false];
      }
      return [provider, statusAvailability];
    }),
  ) as Record<ProviderKind, boolean>;
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => normalizeAppSettings({ ...prev, ...patch }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
