/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the `provider` field in each
 * request input.
 *
 * When `provider` is `"claudeAgent"` the request is forwarded to the Claude
 * layer; for any other value (including the default `undefined`) it falls
 * through to the Codex layer.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, ServiceMap } from "effect";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends ServiceMap.Service<CodexTextGen, TextGenerationShape>()(
  "k1/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends ServiceMap.Service<ClaudeTextGen, TextGenerationShape>()(
  "k1/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

// Gemini/Cursor/OpenCode git text-generation providers currently reuse Codex
// generation. Force codex defaults for those providers to avoid passing
// provider-specific model slugs to the Codex CLI.
const normalizeRoutedInput = <T extends { provider?: TextGenerationProvider; model?: string }>(
  input: T,
): T => {
  if (
    input.provider === "codex" ||
    input.provider === "claudeAgent" ||
    input.provider === undefined
  ) {
    return input;
  }
  return {
    ...input,
    provider: "codex",
    model: undefined,
  };
};

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape =>
    provider === "claudeAgent" ? claude : codex;

  return {
    generateCommitMessage: (input) => {
      const normalized = normalizeRoutedInput(input);
      return route(normalized.provider).generateCommitMessage(normalized);
    },
    generatePrContent: (input) => {
      const normalized = normalizeRoutedInput(input);
      return route(normalized.provider).generatePrContent(normalized);
    },
    generateBranchName: (input) => {
      const normalized = normalizeRoutedInput(input);
      return route(normalized.provider).generateBranchName(normalized);
    },
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));
