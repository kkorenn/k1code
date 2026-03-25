import { type ModelSlug, type ProviderKind } from "@k1tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderModelPicker } from "./ProviderModelPicker";

const MODEL_OPTIONS_BY_PROVIDER = {
  claudeAgent: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  codex: [
    { slug: "gpt-5-codex", name: "GPT-5 Codex" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  ],
  gemini: [
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  cursor: [
    { slug: "gpt-5", name: "GPT 5" },
    { slug: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
  ],
  copilot: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ],
  openCode: [
    { slug: "openai/gpt-5.4", name: "OpenAI GPT 5.4" },
    { slug: "opencode/big-pickle", name: "OpenCode Big Pickle" },
  ],
} as const satisfies Record<ProviderKind, ReadonlyArray<{ slug: ModelSlug; name: string }>>;

async function mountPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providerAvailabilityByProvider?: Partial<Record<ProviderKind, boolean>>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onProviderModelChange = vi.fn();
  const providerAvailabilityProps = props.providerAvailabilityByProvider
    ? { providerAvailabilityByProvider: props.providerAvailabilityByProvider }
    : {};
  const screen = await render(
    <ProviderModelPicker
      provider={props.provider}
      model={props.model}
      lockedProvider={props.lockedProvider}
      modelOptionsByProvider={MODEL_OPTIONS_BY_PROVIDER}
      {...providerAvailabilityProps}
      onProviderModelChange={onProviderModelChange}
    />,
    { container: host },
  );

  return {
    onProviderModelChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ProviderModelPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows provider submenus when provider switching is allowed", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Codex");
        expect(text).toContain("Claude");
        expect(text).toContain("Gemini");
        expect(text).toContain("Cursor");
        expect(text).toContain("Copilot");
        expect(text).toContain("OpenCode");
        expect(text).not.toContain("Claude Sonnet 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows models directly when the provider is locked mid-thread", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Sonnet 4.6");
        expect(text).toContain("Claude Haiku 4.5");
        expect(text).not.toContain("Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("dispatches the canonical slug when a model is selected", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitemradio", { name: "Claude Sonnet 4.6" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        "claude-sonnet-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows unavailable providers as disabled entries", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providerAvailabilityByProvider: {
        codex: true,
        claudeAgent: true,
        gemini: false,
        cursor: true,
        copilot: true,
        openCode: true,
      },
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Gemini");
        expect(text).toContain("Unavailable");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens install guidance when an unavailable provider is selected", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      providerAvailabilityByProvider: {
        codex: true,
        claudeAgent: true,
        gemini: false,
        cursor: true,
        copilot: true,
        openCode: true,
      },
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Gemini Unavailable" }).click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Gemini Unavailable");
        expect(text).toContain("Open provider setup docs");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
