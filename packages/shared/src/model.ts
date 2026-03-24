import {
  CLAUDE_CODE_EFFORT_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  REASONING_EFFORT_OPTIONS_BY_PROVIDER,
  type ClaudeModelOptions,
  type ClaudeCodeEffort,
  type CodexModelOptions,
  type CodexReasoningEffort,
  type ModelSlug,
  type ProviderReasoningEffort,
  type ProviderKind,
} from "@t3tools/contracts";

const MODEL_SLUG_SET_BY_PROVIDER: Record<ProviderKind, ReadonlySet<ModelSlug>> = {
  claudeAgent: new Set(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((option) => option.slug)),
  codex: new Set(MODEL_OPTIONS_BY_PROVIDER.codex.map((option) => option.slug)),
  gemini: new Set(MODEL_OPTIONS_BY_PROVIDER.gemini.map((option) => option.slug)),
  cursor: new Set(MODEL_OPTIONS_BY_PROVIDER.cursor.map((option) => option.slug)),
  openCode: new Set(MODEL_OPTIONS_BY_PROVIDER.openCode.map((option) => option.slug)),
};

const CLAUDE_OPUS_4_6_MODEL = "claude-opus-4-6";
const CLAUDE_SONNET_4_6_MODEL = "claude-sonnet-4-6";
const CLAUDE_HAIKU_4_5_MODEL = "claude-haiku-4-5";

export interface SelectableModelOption {
  slug: string;
  name: string;
}

const DISPLAY_TOKEN_UPPERCASE = new Set([
  "ai",
  "api",
  "cli",
  "cpu",
  "gpu",
  "gpt",
  "http",
  "https",
  "id",
  "ml",
  "sdk",
  "ui",
  "url",
  "ux",
]);
const PROVIDER_PREFIX_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  opencode: "OpenCode",
};
const MODEL_SLUG_DISPLAY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;

function canonicalizeModelDisplayText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function mergeNumericVersionTokens(tokens: ReadonlyArray<string>): string[] {
  const merged: string[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token) && merged.length > 0 && /^\d+(\.\d+)*$/.test(merged.at(-1)!)) {
      merged[merged.length - 1] = `${merged.at(-1)}.${token}`;
      continue;
    }
    merged.push(token);
  }
  return merged;
}

function formatModelDisplayToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  if (DISPLAY_TOKEN_UPPERCASE.has(lower)) {
    return lower.toUpperCase();
  }
  if (/^\d+(\.\d+)+$/.test(lower) || /^\d+$/.test(lower)) {
    return lower;
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function formatModelDisplayName(model: string | null | undefined): string {
  if (typeof model !== "string") {
    return "";
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return "";
  }

  const providerModelMatch = trimmed.match(/^([a-z0-9]+)\/([a-z0-9]+(?:[._-][a-z0-9]+)+)$/i);
  if (providerModelMatch) {
    const providerPrefix = providerModelMatch[1]?.toLowerCase() ?? "";
    const modelSlug = providerModelMatch[2] ?? "";
    const providerDisplay = PROVIDER_PREFIX_DISPLAY[providerPrefix];
    if (providerDisplay) {
      const modelDisplay = formatModelDisplayName(modelSlug);
      return modelDisplay ? `${providerDisplay} ${modelDisplay}` : trimmed;
    }
  }

  if (!MODEL_SLUG_DISPLAY_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const tokens = trimmed
    .replaceAll("_", "-")
    .split("-")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return trimmed;
  }

  return mergeNumericVersionTokens(tokens).map(formatModelDisplayToken).join(" ");
}

export function getModelOptions(provider: ProviderKind = "codex") {
  return MODEL_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultModel(provider: ProviderKind = "codex"): ModelSlug {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function supportsClaudeFastMode(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeAgent") === CLAUDE_OPUS_4_6_MODEL;
}

export function supportsClaudeAdaptiveReasoning(model: string | null | undefined): boolean {
  const normalized = normalizeModelSlug(model, "claudeAgent");
  return normalized === CLAUDE_OPUS_4_6_MODEL || normalized === CLAUDE_SONNET_4_6_MODEL;
}

export function supportsClaudeMaxEffort(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeAgent") === CLAUDE_OPUS_4_6_MODEL;
}

export function supportsClaudeUltrathinkKeyword(model: string | null | undefined): boolean {
  return supportsClaudeAdaptiveReasoning(model);
}

export function supportsClaudeThinkingToggle(model: string | null | undefined): boolean {
  return normalizeModelSlug(model, "claudeAgent") === CLAUDE_HAIKU_4_5_MODEL;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, ModelSlug>;
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : (trimmed as ModelSlug);
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): ModelSlug | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }
  const canonicalLookup = canonicalizeModelDisplayText(trimmed);
  if (canonicalLookup.length > 0) {
    const byCanonicalName = options.find(
      (option) => canonicalizeModelDisplayText(option.name) === canonicalLookup,
    );
    if (byCanonicalName) {
      return byCanonicalName.slug;
    }
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  return MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)
    ? normalized
    : DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSlug {
  return resolveModelSlug(model, provider);
}

export function inferProviderForModel(
  model: string | null | undefined,
  fallback: ProviderKind = "codex",
): ProviderKind {
  const normalizedGemini = normalizeModelSlug(model, "gemini");
  if (normalizedGemini && MODEL_SLUG_SET_BY_PROVIDER.gemini.has(normalizedGemini)) {
    return "gemini";
  }

  const normalizedCursor = normalizeModelSlug(model, "cursor");
  if (normalizedCursor && MODEL_SLUG_SET_BY_PROVIDER.cursor.has(normalizedCursor)) {
    return "cursor";
  }

  const normalizedOpenCode = normalizeModelSlug(model, "openCode");
  if (normalizedOpenCode && MODEL_SLUG_SET_BY_PROVIDER.openCode.has(normalizedOpenCode)) {
    return "openCode";
  }

  const normalizedClaude = normalizeModelSlug(model, "claudeAgent");
  if (normalizedClaude && MODEL_SLUG_SET_BY_PROVIDER.claudeAgent.has(normalizedClaude)) {
    return "claudeAgent";
  }

  const normalizedCodex = normalizeModelSlug(model, "codex");
  if (normalizedCodex && MODEL_SLUG_SET_BY_PROVIDER.codex.has(normalizedCodex)) {
    return "codex";
  }

  if (typeof model !== "string") {
    return fallback;
  }

  const trimmed = model.trim();
  if (trimmed.startsWith("gemini-")) {
    return "gemini";
  }
  if (trimmed.startsWith("opencode/") || trimmed.startsWith("openai/")) {
    return "openCode";
  }
  if (trimmed.startsWith("claude-")) {
    return "claudeAgent";
  }
  return fallback;
}

export function getReasoningEffortOptions(provider: "codex"): ReadonlyArray<CodexReasoningEffort>;
export function getReasoningEffortOptions(
  provider: "claudeAgent",
  model?: string | null | undefined,
): ReadonlyArray<ClaudeCodeEffort>;
export function getReasoningEffortOptions(
  provider?: ProviderKind,
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort>;
export function getReasoningEffortOptions(
  provider: ProviderKind = "codex",
  model?: string | null | undefined,
): ReadonlyArray<ProviderReasoningEffort> {
  if (provider === "claudeAgent") {
    if (supportsClaudeMaxEffort(model)) {
      return ["low", "medium", "high", "max", "ultrathink"];
    }
    if (supportsClaudeAdaptiveReasoning(model)) {
      return ["low", "medium", "high", "ultrathink"];
    }
    return [];
  }
  return REASONING_EFFORT_OPTIONS_BY_PROVIDER[provider];
}

export function getDefaultReasoningEffort(provider: "codex"): CodexReasoningEffort;
export function getDefaultReasoningEffort(provider: "claudeAgent"): ClaudeCodeEffort;
export function getDefaultReasoningEffort(provider?: ProviderKind): ProviderReasoningEffort;
export function getDefaultReasoningEffort(
  provider: ProviderKind = "codex",
): ProviderReasoningEffort {
  return DEFAULT_REASONING_EFFORT_BY_PROVIDER[provider];
}

export function resolveReasoningEffortForProvider(
  provider: "codex",
  effort: string | null | undefined,
): CodexReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: "claudeAgent",
  effort: string | null | undefined,
): ClaudeCodeEffort | null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
): ProviderReasoningEffort | null;
export function resolveReasoningEffortForProvider(
  provider: ProviderKind,
  effort: string | null | undefined,
): ProviderReasoningEffort | null {
  if (typeof effort !== "string") {
    return null;
  }

  const trimmed = effort.trim();
  if (!trimmed) {
    return null;
  }

  const options = REASONING_EFFORT_OPTIONS_BY_PROVIDER[provider] as ReadonlyArray<string>;
  return options.includes(trimmed) ? (trimmed as ProviderReasoningEffort) : null;
}

export function getEffectiveClaudeCodeEffort(
  effort: ClaudeCodeEffort | null | undefined,
): Exclude<ClaudeCodeEffort, "ultrathink"> | null {
  if (!effort) {
    return null;
  }
  return effort === "ultrathink" ? null : effort;
}

export function normalizeCodexModelOptions(
  modelOptions: CodexModelOptions | null | undefined,
): CodexModelOptions | undefined {
  const defaultReasoningEffort = getDefaultReasoningEffort("codex");
  const reasoningEffort =
    resolveReasoningEffortForProvider("codex", modelOptions?.reasoningEffort) ??
    defaultReasoningEffort;
  const fastModeEnabled = modelOptions?.fastMode === true;
  const nextOptions: CodexModelOptions = {
    ...(reasoningEffort !== defaultReasoningEffort ? { reasoningEffort } : {}),
    ...(fastModeEnabled ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  modelOptions: ClaudeModelOptions | null | undefined,
): ClaudeModelOptions | undefined {
  const reasoningOptions = getReasoningEffortOptions("claudeAgent", model);
  const defaultReasoningEffort = getDefaultReasoningEffort("claudeAgent");
  const resolvedEffort = resolveReasoningEffortForProvider("claudeAgent", modelOptions?.effort);
  const effort =
    resolvedEffort &&
    resolvedEffort !== "ultrathink" &&
    reasoningOptions.includes(resolvedEffort) &&
    resolvedEffort !== defaultReasoningEffort
      ? resolvedEffort
      : undefined;
  const thinking =
    supportsClaudeThinkingToggle(model) && modelOptions?.thinking === false ? false : undefined;
  const fastMode =
    supportsClaudeFastMode(model) && modelOptions?.fastMode === true ? true : undefined;
  const nextOptions: ClaudeModelOptions = {
    ...(thinking === false ? { thinking: false } : {}),
    ...(effort ? { effort } : {}),
    ...(fastMode ? { fastMode: true } : {}),
  };
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}

export { CLAUDE_CODE_EFFORT_OPTIONS, CODEX_REASONING_EFFORT_OPTIONS };
