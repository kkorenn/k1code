import type { ProviderKind } from "@t3tools/contracts";

const GEMINI_AUTH_REQUIRED_MESSAGE =
  'Gemini is not authenticated. Run `gemini`, choose "Sign in with Google", and complete login (or set `GEMINI_API_KEY`), then try again.';

function decodeEscapedString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function extractEmbeddedErrorMessage(raw: string): string | null {
  const directMessageMatch = raw.match(/"message"\s*:\s*"((?:\\.|[^"])*)"/i);
  if (directMessageMatch?.[1]) {
    return decodeEscapedString(directMessageMatch[1]).trim();
  }
  return null;
}

function isGeminiAuthError(raw: string, provider: ProviderKind | null): boolean {
  const lower = raw.toLowerCase();
  const includesGeminiHints =
    lower.includes("/.gemini/settings.json") ||
    lower.includes("gemini_api_key") ||
    lower.includes("please set an auth method");

  if (includesGeminiHints) {
    return true;
  }

  if (provider !== "gemini") {
    return false;
  }

  return (
    lower.includes("please run /login") ||
    lower.includes("not logged in") ||
    lower.includes("authentication required")
  );
}

export function normalizeProviderErrorMessage(
  message: string | null | undefined,
  provider: ProviderKind | null = null,
): string | null {
  if (typeof message !== "string") {
    return null;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const embeddedErrorMessage = extractEmbeddedErrorMessage(trimmed);
  const normalized =
    embeddedErrorMessage && embeddedErrorMessage.length > 0 ? embeddedErrorMessage : trimmed;

  if (isGeminiAuthError(normalized, provider)) {
    return GEMINI_AUTH_REQUIRED_MESSAGE;
  }

  return normalized;
}

export function isLikelyProviderAuthError(
  message: string | null | undefined,
  provider: ProviderKind | null = null,
): boolean {
  const normalized = normalizeProviderErrorMessage(message, provider);
  if (!normalized) {
    return false;
  }
  if (normalized === GEMINI_AUTH_REQUIRED_MESSAGE) {
    return true;
  }
  const lower = normalized.toLowerCase();
  return (
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("authentication required") ||
    lower.includes("unauthenticated") ||
    lower.includes("run `codex login`") ||
    lower.includes("run `claude auth login`")
  );
}
