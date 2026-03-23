import { useCallback } from "react";
import { Option, Schema } from "effect";
import {
  TrimmedNonEmptyString,
  type ProviderKind,
  type ProviderModelOption,
  type ProviderModelOptionsByProvider,
} from "@t3tools/contracts";
import {
  formatModelDisplayName,
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { EnvMode } from "./components/BranchToolbar.logic";

const APP_SETTINGS_STORAGE_KEY = "k1code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const MAX_FONT_FAMILY_LENGTH = 256;

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const UiFontSize = Schema.Literals(["sm", "md", "lg"]);
export type UiFontSize = typeof UiFontSize.Type;
export const DEFAULT_UI_FONT_SIZE: UiFontSize = "md";

export const TerminalFontSize = Schema.Literals(["sm", "md", "lg", "xl"]);
export type TerminalFontSize = typeof TerminalFontSize.Type;
export const DEFAULT_TERMINAL_FONT_SIZE: TerminalFontSize = "md";
type CustomModelSettingsKey = "customCodexModels" | "customClaudeModels" | "customGeminiModels";
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
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  geminiBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),
  diffWordWrap: Schema.Boolean.pipe(withDefaults(() => false)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => false)),
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
  textGenerationProvider: Schema.Literals(["codex", "claudeAgent"]).pipe(
    withDefaults(() => "codex" as const),
  ),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
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
};
export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

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
  };
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
