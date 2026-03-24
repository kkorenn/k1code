import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TIMESTAMP_FORMAT,
  DEFAULT_UI_FONT_SIZE,
  getAppModelOptions,
  getCustomModelOptionsByProvider,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getProviderStartOptions,
  MODEL_PROVIDER_SETTINGS,
  normalizeCustomModelSlugs,
  patchCustomModels,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("normalizes provider-specific aliases for claude", () => {
    expect(normalizeCustomModelSlugs(["sonnet"], "claudeAgent")).toEqual([]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "claudeAgent")).toEqual([
      "claude/custom-sonnet",
    ]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });
  it("keeps a saved custom provider model available as an exact slug option", () => {
    const options = getAppModelOptions("claudeAgent", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });

  it("prefers discovered provider models and formats display names without dashes", () => {
    const options = getAppModelOptions("codex", [], undefined, [
      { slug: "gpt-5.4-mini", name: "gpt-5.4-mini" },
    ]);

    expect(options).toEqual([
      {
        slug: "gpt-5.4-mini",
        name: "GPT 5.4 Mini",
        isCustom: false,
      },
    ]);
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        {
          codex: ["galapagos-alpha"],
          claudeAgent: [],
          gemini: [],
          cursor: [],
          openCode: [],
        },
        "galapagos-alpha",
      ),
    ).toBe("galapagos-alpha");
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { codex: [], claudeAgent: [], gemini: [], cursor: [], openCode: [] },
        "",
      ),
    ).toBe("gpt-5.4");
  });

  it("resolves display names through the shared resolver", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { codex: [], claudeAgent: [], gemini: [], cursor: [], openCode: [] },
        "GPT-5.3 Codex",
      ),
    ).toBe("gpt-5.3-codex");
  });

  it("resolves aliases through the shared resolver", () => {
    expect(
      resolveAppModelSelection(
        "claudeAgent",
        { codex: [], claudeAgent: [], gemini: [], cursor: [], openCode: [] },
        "sonnet",
      ),
    ).toBe("claude-sonnet-4-6");
  });

  it("resolves transient selected custom models included in app model options", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { codex: [], claudeAgent: [], gemini: [], cursor: [], openCode: [] },
        "custom/selected-model",
      ),
    ).toBe("custom/selected-model");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("provider-specific custom models", () => {
  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeAgent", ["claude/custom-opus"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
  });
});

describe("getProviderStartOptions", () => {
  it("returns only populated provider overrides", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "/usr/local/bin/claude",
        codexBinaryPath: "",
        codexHomePath: "/Users/you/.codex",
        geminiBinaryPath: "/usr/local/bin/gemini",
        cursorBinaryPath: "",
        openCodeBinaryPath: "/usr/local/bin/opencode",
      }),
    ).toEqual({
      claudeAgent: {
        binaryPath: "/usr/local/bin/claude",
      },
      codex: {
        homePath: "/Users/you/.codex",
      },
      gemini: {
        binaryPath: "/usr/local/bin/gemini",
      },
      openCode: {
        binaryPath: "/usr/local/bin/opencode",
      },
    });
  });

  it("returns undefined when no provider overrides are configured", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "",
        codexBinaryPath: "",
        codexHomePath: "",
        geminiBinaryPath: "",
        cursorBinaryPath: "",
        openCodeBinaryPath: "",
      }),
    ).toBeUndefined();
  });
});

describe("provider-indexed custom model settings", () => {
  const settings = {
    customCodexModels: ["custom/codex-model"],
    customClaudeModels: ["claude/custom-opus"],
    customGeminiModels: ["gemini/custom-pro"],
    customCursorModels: ["cursor/custom-pro"],
    customOpenCodeModels: ["opencode/custom-pro"],
  } as const;

  it("exports one provider config per provider", () => {
    expect(MODEL_PROVIDER_SETTINGS.map((config) => config.provider)).toEqual([
      "codex",
      "claudeAgent",
      "gemini",
      "cursor",
      "openCode",
    ]);
  });

  it("reads custom models for each provider", () => {
    expect(getCustomModelsForProvider(settings, "codex")).toEqual(["custom/codex-model"]);
    expect(getCustomModelsForProvider(settings, "claudeAgent")).toEqual(["claude/custom-opus"]);
    expect(getCustomModelsForProvider(settings, "gemini")).toEqual(["gemini/custom-pro"]);
    expect(getCustomModelsForProvider(settings, "cursor")).toEqual(["cursor/custom-pro"]);
    expect(getCustomModelsForProvider(settings, "openCode")).toEqual(["opencode/custom-pro"]);
  });

  it("reads default custom models for each provider", () => {
    const defaults = {
      customCodexModels: ["default/codex-model"],
      customClaudeModels: ["claude/default-opus"],
      customGeminiModels: ["gemini/default-pro"],
      customCursorModels: ["cursor/default-pro"],
      customOpenCodeModels: ["opencode/default-pro"],
    } as const;

    expect(getDefaultCustomModelsForProvider(defaults, "codex")).toEqual(["default/codex-model"]);
    expect(getDefaultCustomModelsForProvider(defaults, "claudeAgent")).toEqual([
      "claude/default-opus",
    ]);
    expect(getDefaultCustomModelsForProvider(defaults, "gemini")).toEqual(["gemini/default-pro"]);
    expect(getDefaultCustomModelsForProvider(defaults, "cursor")).toEqual(["cursor/default-pro"]);
    expect(getDefaultCustomModelsForProvider(defaults, "openCode")).toEqual([
      "opencode/default-pro",
    ]);
  });

  it("patches custom models for codex", () => {
    expect(patchCustomModels("codex", ["custom/codex-model"])).toEqual({
      customCodexModels: ["custom/codex-model"],
    });
  });

  it("patches custom models for claude", () => {
    expect(patchCustomModels("claudeAgent", ["claude/custom-opus"])).toEqual({
      customClaudeModels: ["claude/custom-opus"],
    });
  });

  it("patches custom models for gemini", () => {
    expect(patchCustomModels("gemini", ["gemini/custom-pro"])).toEqual({
      customGeminiModels: ["gemini/custom-pro"],
    });
  });

  it("patches custom models for cursor", () => {
    expect(patchCustomModels("cursor", ["cursor/custom-pro"])).toEqual({
      customCursorModels: ["cursor/custom-pro"],
    });
  });

  it("patches custom models for openCode", () => {
    expect(patchCustomModels("openCode", ["opencode/custom-pro"])).toEqual({
      customOpenCodeModels: ["opencode/custom-pro"],
    });
  });

  it("builds a complete provider-indexed custom model record", () => {
    expect(getCustomModelsByProvider(settings)).toEqual({
      codex: ["custom/codex-model"],
      claudeAgent: ["claude/custom-opus"],
      gemini: ["gemini/custom-pro"],
      cursor: ["cursor/custom-pro"],
      openCode: ["opencode/custom-pro"],
    });
  });

  it("builds provider-indexed model options including custom models", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

    expect(
      modelOptionsByProvider.codex.some((option) => option.slug === "custom/codex-model"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude/custom-opus"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.gemini.some((option) => option.slug === "gemini/custom-pro"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.cursor.some((option) => option.slug === "cursor/custom-pro"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.openCode.some((option) => option.slug === "opencode/custom-pro"),
    ).toBe(true);
  });

  it("normalizes and deduplicates custom model options per provider", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider({
      customCodexModels: ["  custom/codex-model ", "gpt-5.4", "custom/codex-model"],
      customClaudeModels: [" sonnet ", "claude/custom-opus", "claude/custom-opus"],
      customGeminiModels: [" gemini-2.5-flash ", "gemini/custom-pro", "gemini/custom-pro"],
      customCursorModels: [" claude-4.5-sonnet ", "cursor/custom-pro", "cursor/custom-pro"],
      customOpenCodeModels: [" openai/gpt-5.4 ", "opencode/custom-pro", "opencode/custom-pro"],
    });

    expect(
      modelOptionsByProvider.codex.filter((option) => option.slug === "custom/codex-model"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.codex.some((option) => option.slug === "gpt-5.4")).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.filter((option) => option.slug === "claude/custom-opus"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude-sonnet-4-6"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.gemini.filter((option) => option.slug === "gemini/custom-pro"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.gemini.some((option) => option.slug === "gemini-2.5-flash")).toBe(
      true,
    );
    expect(
      modelOptionsByProvider.cursor.filter((option) => option.slug === "cursor/custom-pro"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.cursor.some((option) => option.slug === "claude-4.5-sonnet"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.openCode.filter((option) => option.slug === "opencode/custom-pro"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.openCode.some((option) => option.slug === "openai/gpt-5.4")).toBe(
      true,
    );
  });
});

describe("AppSettingsSchema", () => {
  it("fills decoding defaults for persisted settings that predate newer keys", () => {
    const decode = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema));

    expect(
      decode(
        JSON.stringify({
          codexBinaryPath: "/usr/local/bin/codex",
          confirmThreadDelete: false,
        }),
      ),
    ).toMatchObject({
      claudeBinaryPath: "",
      codexBinaryPath: "/usr/local/bin/codex",
      geminiBinaryPath: "",
      cursorBinaryPath: "",
      openCodeBinaryPath: "",
      codexHomePath: "",
      newProjectBasePath: "",
      defaultThreadEnvMode: "local",
      confirmThreadDelete: false,
      enableAssistantStreaming: false,
      timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
      uiFontSize: DEFAULT_UI_FONT_SIZE,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      uiFontFamily: "",
      monoFontFamily: "",
      customCodexModels: [],
      customClaudeModels: [],
      customGeminiModels: [],
      customCursorModels: [],
      customOpenCodeModels: [],
    });
  });
});
