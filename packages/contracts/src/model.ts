import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import type { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];
export const CLAUDE_CODE_EFFORT_OPTIONS = ["low", "medium", "high", "max", "ultrathink"] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];
export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

export const GeminiModelOptions = Schema.Struct({});
export type GeminiModelOptions = typeof GeminiModelOptions.Type;

export const CursorModelOptions = Schema.Struct({});
export type CursorModelOptions = typeof CursorModelOptions.Type;

export const CopilotModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
});
export type CopilotModelOptions = typeof CopilotModelOptions.Type;

export const OpenCodeModelOptions = Schema.Struct({});
export type OpenCodeModelOptions = typeof OpenCodeModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  gemini: Schema.optional(GeminiModelOptions),
  cursor: Schema.optional(CursorModelOptions),
  copilot: Schema.optional(CopilotModelOptions),
  openCode: Schema.optional(OpenCodeModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

export const ProviderModelOption = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type ProviderModelOption = typeof ProviderModelOption.Type;

export const ProviderModelOptionsByProvider = Schema.Struct({
  codex: Schema.Array(ProviderModelOption),
  claudeAgent: Schema.Array(ProviderModelOption),
  gemini: Schema.Array(ProviderModelOption),
  cursor: Schema.Array(ProviderModelOption),
  copilot: Schema.Array(ProviderModelOption),
  openCode: Schema.Array(ProviderModelOption),
});
export type ProviderModelOptionsByProvider = typeof ProviderModelOptionsByProvider.Type;

type BuiltInModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  claudeAgent: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { slug: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { slug: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { slug: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
  cursor: [
    { slug: "gpt-5", name: "GPT 5" },
    { slug: "gpt-5-mini", name: "GPT 5 Mini" },
    { slug: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
  ],
  copilot: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  openCode: [
    { slug: "openai/gpt-5.4", name: "OpenAI GPT 5.4" },
    { slug: "openai/gpt-5.3-codex", name: "OpenAI GPT 5.3 Codex" },
    { slug: "openai/gpt-5.2-codex", name: "OpenAI GPT 5.2 Codex" },
    { slug: "openai/gpt-5.2", name: "OpenAI GPT 5.2" },
    { slug: "opencode/big-pickle", name: "OpenCode Big Pickle" },
  ],
} as const satisfies Record<ProviderKind, readonly BuiltInModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, ModelSlug> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  gemini: "gemini-2.5-pro",
  cursor: "gpt-5",
  copilot: "gpt-5.4",
  openCode: "openai/gpt-5.4",
};

// Backward compatibility for existing Codex-only call sites.
export const MODEL_OPTIONS = MODEL_OPTIONS_BY_PROVIDER.codex;
export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;

/** Per-provider text generation model defaults. */
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4-mini",
  claudeAgent: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
  cursor: "gpt-5-mini",
  copilot: "gpt-5.4-mini",
  openCode: "openai/gpt-5.4",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, ModelSlug>> = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  gemini: {
    "3-pro": "gemini-3-pro-preview",
    "3-flash": "gemini-3-flash-preview",
    "3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    "2.5-pro": "gemini-2.5-pro",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-pro": "gemini-2.5-pro",
    "gemini-flash": "gemini-2.5-flash",
    "gemini-flash-lite": "gemini-2.5-flash-lite",
  },
  cursor: {
    sonnet: "claude-4.5-sonnet",
    "gpt-5.0": "gpt-5",
  },
  copilot: {
    "gpt-5.4-mini": "gpt-5.4-mini",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
  },
  openCode: {
    "gpt-5.4": "openai/gpt-5.4",
    "gpt-5.3-codex": "openai/gpt-5.3-codex",
    "gpt-5.2-codex": "openai/gpt-5.2-codex",
    "gpt-5.2": "openai/gpt-5.2",
  },
};

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  claudeAgent: CLAUDE_CODE_EFFORT_OPTIONS,
  gemini: [],
  cursor: [],
  copilot: CODEX_REASONING_EFFORT_OPTIONS,
  openCode: [],
} as const satisfies Record<ProviderKind, readonly ProviderReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  claudeAgent: "high",
  gemini: "high",
  cursor: "high",
  copilot: "high",
  openCode: "high",
} as const satisfies Record<ProviderKind, ProviderReasoningEffort>;
