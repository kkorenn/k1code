import { spawn } from "node:child_process";
import readline from "node:readline";
import { stripVTControlCharacters } from "node:util";

import type {
  ProviderKind,
  ProviderModelOption,
  ProviderModelOptionsByProvider,
} from "@t3tools/contracts";
import { formatModelDisplayName } from "@t3tools/shared/model";

import { buildCodexInitializeParams } from "../codexAppServerManager";

const COMMAND_TIMEOUT_MS = 4_000;
const CODEX_DISCOVERY_TIMEOUT_MS = 8_000;
const MODEL_CACHE_TTL_MS = 60_000;

const GEMINI_MODEL_SLUG_PATTERN = /\bgemini-[a-z0-9]+(?:[.-][a-z0-9]+)+\b/gi;
const CLAUDE_MODEL_SLUG_PATTERN = /\bclaude-[a-z0-9]+(?:-[a-z0-9]+)+\b/gi;
const OPENCODE_MODEL_SLUG_PATTERN = /\b[a-z0-9]+\/[a-z0-9]+(?:[.-][a-z0-9]+)+\b/gi;

let cachedProviderModels: ProviderModelOptionsByProvider | null = null;
let cachedProviderModelsAt = 0;
let pendingDiscovery: Promise<ProviderModelOptionsByProvider> | null = null;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

function toProviderModelOption(slug: string): ProviderModelOption | null {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  const displayName = formatModelDisplayName(normalizedSlug);
  return {
    slug: normalizedSlug,
    name: displayName || normalizedSlug,
  };
}

function dedupeModelOptions(options: ReadonlyArray<ProviderModelOption>): ProviderModelOption[] {
  const deduped: ProviderModelOption[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.slug)) {
      continue;
    }
    seen.add(option.slug);
    deduped.push(option);
  }
  return deduped;
}

function emptyProviderModels(): ProviderModelOptionsByProvider {
  return {
    codex: [],
    claudeAgent: [],
    gemini: [],
    cursor: [],
    openCode: [],
  };
}

function extractModelOptionsByPattern(
  provider: ProviderKind,
  output: string,
  pattern: RegExp,
): ProviderModelOption[] {
  const matches = output.match(pattern) ?? [];
  const options = matches.flatMap((match) => {
    const option = toProviderModelOption(match);
    return option ? [option] : [];
  });
  return dedupeModelOptions(options).filter((option) =>
    provider === "gemini"
      ? option.slug.startsWith("gemini-")
      : provider === "claudeAgent"
        ? option.slug.startsWith("claude-")
        : provider === "openCode"
          ? option.slug.includes("/")
          : true,
  );
}

function parseModelSlugLines(
  output: string,
  isCandidate: (value: string) => boolean,
): ProviderModelOption[] {
  const options = output
    .split(/\r?\n/)
    .map((line) => stripVTControlCharacters(line).trim())
    .flatMap((line) => {
      if (!line) {
        return [];
      }
      const withoutBullet = line.replace(/^\d+\.\s+/, "");
      const firstToken = withoutBullet.split(/\s+/)[0]?.trim() ?? "";
      if (!firstToken || !isCandidate(firstToken)) {
        return [];
      }
      const option = toProviderModelOption(firstToken);
      return option ? [option] : [];
    });
  return dedupeModelOptions(options);
}

function parseJsonRpcErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Request failed";
  }
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message.trim();
  }
  if (typeof record.code === "number") {
    return `Request failed with code ${record.code}.`;
  }
  return "Request failed";
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runCommand(
  binary: string,
  args: ReadonlyArray<string>,
  timeoutMs: number = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  return await withTimeout(
    new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(binary, [...args], {
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });

      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
          code,
          signal,
        });
      });
    }),
    timeoutMs,
    `Timed out while running ${binary}.`,
  );
}

function parseCodexModelListResult(result: unknown): ProviderModelOption[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }

  const options = data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as { id?: unknown; slug?: unknown };
    const slug =
      typeof candidate.id === "string"
        ? candidate.id
        : typeof candidate.slug === "string"
          ? candidate.slug
          : null;
    if (typeof slug !== "string") {
      return [];
    }
    const option = toProviderModelOption(slug);
    return option ? [option] : [];
  });

  return dedupeModelOptions(options);
}

async function discoverCodexModelsUncached(): Promise<ProviderModelOption[]> {
  const child = spawn("codex", ["app-server"], {
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout });

  let nextRequestId = 1;
  let disposed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  const rejectPending = (error: unknown) => {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    rejectPending(new Error("Codex model discovery stopped before completion."));
    try {
      output.close();
    } catch {
      // Ignore teardown errors.
    }
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    if (!child.killed) {
      child.kill();
    }
  };

  const writeJsonRpcMessage = (message: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(new Error("Codex model discovery session is closed."));
        return;
      }
      const payload = `${JSON.stringify(message)}\n`;
      child.stdin.write(payload, "utf8", (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

  const sendRequest = async (method: string, params: unknown): Promise<unknown> => {
    const id = nextRequestId++;
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Codex '${method}' response.`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timeout });
    });

    try {
      await writeJsonRpcMessage({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    } catch (error) {
      const pendingRequest = pending.get(id);
      if (pendingRequest) {
        pending.delete(id);
        clearTimeout(pendingRequest.timeout);
        pendingRequest.reject(error);
      }
      throw error;
    }

    return await responsePromise;
  };

  output.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }
    const id = (message as { id?: unknown }).id;
    if (typeof id !== "number") {
      return;
    }
    const pendingRequest = pending.get(id);
    if (!pendingRequest) {
      return;
    }
    pending.delete(id);
    clearTimeout(pendingRequest.timeout);

    const response = message as { result?: unknown; error?: unknown };
    if (response.error !== undefined) {
      pendingRequest.reject(new Error(parseJsonRpcErrorMessage(response.error)));
      return;
    }
    pendingRequest.resolve(response.result);
  });

  child.once("error", (error) => {
    rejectPending(error);
  });
  child.once("exit", (code, signal) => {
    if (pending.size === 0) {
      return;
    }
    rejectPending(
      new Error(`Codex model discovery exited early (code: ${code}, signal: ${signal}).`),
    );
  });

  try {
    await sendRequest("initialize", buildCodexInitializeParams());
    await writeJsonRpcMessage({
      jsonrpc: "2.0",
      method: "initialized",
    });
    const modelListResult = await sendRequest("model/list", {});
    return parseCodexModelListResult(modelListResult);
  } finally {
    dispose();
  }
}

async function discoverCodexModels(): Promise<ProviderModelOption[]> {
  try {
    return await withTimeout(
      discoverCodexModelsUncached(),
      CODEX_DISCOVERY_TIMEOUT_MS,
      "Timed out while discovering Codex models.",
    );
  } catch {
    return [];
  }
}

async function discoverGeminiModels(): Promise<ProviderModelOption[]> {
  try {
    const [interactive, fallback] = await Promise.all([
      runCommand("gemini", ["-p", "/model", "-o", "json"]).catch(() => null),
      runCommand("gemini", ["--help"]).catch(() => null),
    ]);
    const aggregateOutput = `${interactive?.stdout ?? ""}\n${interactive?.stderr ?? ""}\n${fallback?.stdout ?? ""}\n${fallback?.stderr ?? ""}`;
    return extractModelOptionsByPattern("gemini", aggregateOutput, GEMINI_MODEL_SLUG_PATTERN);
  } catch {
    return [];
  }
}

async function discoverClaudeModels(): Promise<ProviderModelOption[]> {
  try {
    const [modelPrompt, help] = await Promise.all([
      runCommand("claude", ["-p", "/model"]).catch(() => null),
      runCommand("claude", ["--help"]).catch(() => null),
    ]);
    const aggregateOutput = `${modelPrompt?.stdout ?? ""}\n${modelPrompt?.stderr ?? ""}\n${help?.stdout ?? ""}\n${help?.stderr ?? ""}`;
    return extractModelOptionsByPattern("claudeAgent", aggregateOutput, CLAUDE_MODEL_SLUG_PATTERN);
  } catch {
    return [];
  }
}

async function discoverCursorModels(): Promise<ProviderModelOption[]> {
  try {
    const [modelsCommand, modelPrompt] = await Promise.all([
      runCommand("cursor-agent", ["models"]).catch(() => null),
      runCommand("cursor-agent", ["-p", "/model", "--force", "--output-format", "text"]).catch(
        () => null,
      ),
    ]);
    const aggregateOutput = `${modelsCommand?.stdout ?? ""}\n${modelsCommand?.stderr ?? ""}\n${modelPrompt?.stdout ?? ""}\n${modelPrompt?.stderr ?? ""}`;
    return parseModelSlugLines(aggregateOutput, (candidate) => {
      return (
        candidate.startsWith("gpt-") ||
        candidate.startsWith("claude-") ||
        candidate.startsWith("gemini-") ||
        candidate.startsWith("o1") ||
        candidate.startsWith("o3") ||
        candidate.startsWith("o4")
      );
    });
  } catch {
    return [];
  }
}

async function discoverOpenCodeModels(): Promise<ProviderModelOption[]> {
  try {
    const [models, openAiModels, help] = await Promise.all([
      runCommand("opencode", ["models"]).catch(() => null),
      runCommand("opencode", ["models", "openai"]).catch(() => null),
      runCommand("opencode", ["--help"]).catch(() => null),
    ]);
    const aggregateOutput = `${models?.stdout ?? ""}\n${models?.stderr ?? ""}\n${openAiModels?.stdout ?? ""}\n${openAiModels?.stderr ?? ""}\n${help?.stdout ?? ""}\n${help?.stderr ?? ""}`;
    return extractModelOptionsByPattern("openCode", aggregateOutput, OPENCODE_MODEL_SLUG_PATTERN);
  } catch {
    return [];
  }
}

async function discoverProviderModelsUncached(): Promise<ProviderModelOptionsByProvider> {
  const [codex, claudeAgent, gemini, cursor, openCode] = await Promise.all([
    discoverCodexModels(),
    discoverClaudeModels(),
    discoverGeminiModels(),
    discoverCursorModels(),
    discoverOpenCodeModels(),
  ]);

  return {
    codex,
    claudeAgent,
    gemini,
    cursor,
    openCode,
  };
}

export async function discoverProviderModels(): Promise<ProviderModelOptionsByProvider> {
  const now = Date.now();
  if (cachedProviderModels && now - cachedProviderModelsAt < MODEL_CACHE_TTL_MS) {
    return cachedProviderModels;
  }
  if (pendingDiscovery) {
    return pendingDiscovery;
  }

  pendingDiscovery = discoverProviderModelsUncached()
    .then((discovered) => {
      cachedProviderModels = discovered;
      cachedProviderModelsAt = Date.now();
      return discovered;
    })
    .catch(() => {
      const empty = emptyProviderModels();
      cachedProviderModels = empty;
      cachedProviderModelsAt = Date.now();
      return empty;
    })
    .finally(() => {
      pendingDiscovery = null;
    });

  return pendingDiscovery;
}
