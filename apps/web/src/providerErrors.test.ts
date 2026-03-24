import { describe, expect, it } from "vitest";

import { isLikelyProviderAuthError, normalizeProviderErrorMessage } from "./providerErrors";

describe("normalizeProviderErrorMessage", () => {
  it("normalizes embedded Gemini auth JSON payloads to a friendly message", () => {
    const raw =
      'YOLO mode is enabled. { "session_id": "abc", "error": { "type": "Error", "message": "Please set an Auth method in your /Users/koren/.gemini/settings.json" } }';

    expect(normalizeProviderErrorMessage(raw, "gemini")).toBe(
      'Gemini is not authenticated. Run `gemini`, choose "Sign in with Google", and complete login (or set `GEMINI_API_KEY`), then try again.',
    );
  });

  it("maps Gemini login dismissal errors to the same auth hint", () => {
    expect(normalizeProviderErrorMessage("Not logged in · Please run /login", "gemini")).toBe(
      'Gemini is not authenticated. Run `gemini`, choose "Sign in with Google", and complete login (or set `GEMINI_API_KEY`), then try again.',
    );
  });

  it("keeps non-auth errors unchanged", () => {
    expect(normalizeProviderErrorMessage("Something else failed", "gemini")).toBe(
      "Something else failed",
    );
  });
});

describe("isLikelyProviderAuthError", () => {
  it("detects normalized Gemini auth failures", () => {
    expect(isLikelyProviderAuthError("Not logged in · Please run /login", "gemini")).toBe(true);
  });
});
