/**
 * CursorAdapterLive - Scoped live implementation for the Cursor provider adapter.
 *
 * Runs Cursor Agent CLI in non-interactive mode per turn and projects outputs
 * into canonical provider runtime events consumed by orchestration.
 *
 * @module CursorAdapterLive
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ChatAttachment,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "cursor" as const;
const DEFAULT_CURSOR_BINARY_PATH = "cursor-agent";
const DEFAULT_CURSOR_MODEL = "gpt-5";
const MAX_HISTORY_TURNS = 24;
const MAX_HISTORY_CHARS = 18_000;
const CURSOR_AUTH_REQUIRED_MESSAGE =
  "Cursor is not authenticated. Run `cursor-agent login` and try again.";

interface CursorTurnRecord {
  readonly id: TurnId;
  readonly prompt: string;
  readonly response: string;
  readonly createdAt: string;
  readonly items: ReadonlyArray<unknown>;
}

interface CursorRunningTurn {
  readonly turnId: TurnId;
  readonly interactionMode: "default" | "plan";
  readonly itemId: RuntimeItemId;
  process: ChildProcess | null;
  interrupted: boolean;
}

interface CursorSessionContext {
  session: ProviderSession;
  binaryPath: string;
  turns: CursorTurnRecord[];
  runningTurn: CursorRunningTurn | null;
}

export interface CursorAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function toSessionNotFound(
  threadId: ThreadId,
  cause?: unknown,
): ProviderAdapterSessionNotFoundError {
  return new ProviderAdapterSessionNotFoundError({
    provider: PROVIDER,
    threadId,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toSessionClosed(threadId: ThreadId, cause?: unknown): ProviderAdapterSessionClosedError {
  return new ProviderAdapterSessionClosedError({
    provider: PROVIDER,
    threadId,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function makeRuntimeEventBase(input: {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly itemId?: RuntimeItemId;
}) {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: input.itemId } : {}),
  } as const;
}

function parseCursorOutput(input: { readonly stdout: string; readonly stderr: string }): {
  readonly response: string;
  readonly error?: string;
} {
  const stdoutTrimmed = input.stdout.trim();
  if (!stdoutTrimmed) {
    return { response: "", ...(input.stderr.trim() ? { error: input.stderr.trim() } : {}) };
  }

  if (stdoutTrimmed.startsWith("{") || stdoutTrimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(stdoutTrimmed) as {
        response?: unknown;
        text?: unknown;
        error?: { message?: unknown } | unknown;
      };
      const response =
        typeof parsed.response === "string"
          ? parsed.response.trim()
          : typeof parsed.text === "string"
            ? parsed.text.trim()
            : "";
      const errorMessage =
        parsed.error && typeof parsed.error === "object" && parsed.error !== null
          ? typeof (parsed.error as { message?: unknown }).message === "string"
            ? (parsed.error as { message: string }).message.trim()
            : undefined
          : typeof parsed.error === "string"
            ? parsed.error.trim()
            : undefined;
      if (response.length > 0) {
        return { response, ...(errorMessage ? { error: errorMessage } : {}) };
      }
      if (errorMessage) {
        return { response: "", error: errorMessage };
      }
    } catch {
      // Fallback to treating stdout as plain text.
    }
  }

  return { response: stdoutTrimmed };
}

function extractCursorStructuredErrorMessage(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const startIndex = trimmed.indexOf("{");
  const endIndex = trimmed.lastIndexOf("}");
  if (startIndex < 0 || endIndex <= startIndex) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as {
      error?: { message?: unknown } | unknown;
      message?: unknown;
    };
    if (parsed.error && typeof parsed.error === "object" && parsed.error !== null) {
      const message = (parsed.error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
    }
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    // Ignore parse errors and fallback to raw text.
  }

  return undefined;
}

function normalizeCursorFailureMessage(raw: string): string {
  const structuredMessage = extractCursorStructuredErrorMessage(raw);
  const message = (structuredMessage ?? raw).trim();
  const lower = message.toLowerCase();
  if (
    lower.includes("not authenticated") ||
    lower.includes("not logged in") ||
    lower.includes("authentication required") ||
    lower.includes("run `cursor-agent login`") ||
    lower.includes("run cursor-agent login")
  ) {
    return CURSOR_AUTH_REQUIRED_MESSAGE;
  }
  return message;
}

function buildAttachmentContext(input: {
  readonly attachmentsDir: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}): string {
  if (input.attachments.length === 0) {
    return "";
  }

  const lines = input.attachments.map((attachment, index) => {
    const absolutePath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    const pathText = absolutePath && existsSync(absolutePath) ? absolutePath : "unavailable";
    return [
      `Attachment ${index + 1}:`,
      `- type: ${attachment.type}`,
      `- name: ${attachment.name}`,
      `- mimeType: ${attachment.mimeType}`,
      `- sizeBytes: ${attachment.sizeBytes}`,
      `- path: ${pathText}`,
    ].join("\n");
  });

  return `\n\n## Attachments\n${lines.join("\n\n")}`;
}

function buildPromptWithHistory(input: {
  readonly turns: ReadonlyArray<CursorTurnRecord>;
  readonly prompt: string;
  readonly attachmentContext: string;
  readonly interactionMode: "default" | "plan";
}): string {
  const historyTurns = input.turns.slice(-MAX_HISTORY_TURNS);
  const historyChunks: string[] = [];
  for (const turn of historyTurns) {
    historyChunks.push(`User:\n${turn.prompt}\n\nAssistant:\n${turn.response}`);
  }
  let historyText = historyChunks.join("\n\n---\n\n");
  if (historyText.length > MAX_HISTORY_CHARS) {
    historyText = historyText.slice(historyText.length - MAX_HISTORY_CHARS);
  }

  const modePrefix =
    input.interactionMode === "plan"
      ? "You are in planning mode. Reply with a concrete markdown plan, not implementation steps executed."
      : "";

  const parts = [
    modePrefix,
    historyText.length > 0 ? `## Conversation history\n${historyText}` : "",
    `## Current user message\n${input.prompt}${input.attachmentContext}`,
  ].filter((part) => part.length > 0);
  return parts.join("\n\n");
}

function createCursorTurnItems(prompt: string, response: string): ReadonlyArray<unknown> {
  return [
    { role: "user", content: [{ type: "text", text: prompt }] },
    { role: "assistant", content: [{ type: "text", text: response }] },
  ];
}

const makeCursorAdapter = (options?: CursorAdapterLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* Effect.service(ServerConfig);
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);

    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, CursorSessionContext>();

    const emitRuntimeEvent = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

    const logNativeEvent = (event: Record<string, unknown>, threadId: ThreadId) =>
      nativeEventLogger ? nativeEventLogger.write(event, threadId) : Effect.void;

    const getSessionContext = (
      threadId: ThreadId,
    ): Effect.Effect<CursorSessionContext, ProviderAdapterSessionNotFoundError> => {
      const session = sessions.get(threadId);
      return session ? Effect.succeed(session) : Effect.fail(toSessionNotFound(threadId));
    };

    const startSession: CursorAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "CursorAdapter.startSession",
            issue: `Expected provider '${PROVIDER}' but received '${String(input.provider)}'.`,
          });
        }

        const existing = sessions.get(input.threadId);
        const binaryPath =
          input.providerOptions?.cursor?.binaryPath?.trim() ||
          existing?.binaryPath ||
          DEFAULT_CURSOR_BINARY_PATH;
        const now = nowIso();
        const model = input.model?.trim() || existing?.session.model || DEFAULT_CURSOR_MODEL;

        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
          ...(model ? { model } : {}),
          threadId: input.threadId,
          createdAt: existing?.session.createdAt ?? now,
          updatedAt: now,
        };

        const nextContext: CursorSessionContext = {
          session,
          binaryPath,
          turns: existing?.turns ?? [],
          runningTurn: existing?.runningTurn ?? null,
        };
        sessions.set(input.threadId, nextContext);

        yield* logNativeEvent(
          {
            type: "cursor.session.started",
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            model,
            binaryPath,
          },
          input.threadId,
        );

        yield* emitRuntimeEvent({
          type: "session.started",
          ...makeRuntimeEventBase({ threadId: input.threadId }),
          payload: {
            message: "Cursor session started",
          },
        });
        yield* emitRuntimeEvent({
          type: "thread.started",
          ...makeRuntimeEventBase({ threadId: input.threadId }),
          payload: {
            providerThreadId: input.threadId,
          },
        });
        yield* emitRuntimeEvent({
          type: "session.state.changed",
          ...makeRuntimeEventBase({ threadId: input.threadId }),
          payload: {
            state: "ready",
          },
        });

        return session;
      });

    const executeCursorTurnCommand = (input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly binaryPath: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string;
      readonly runningTurn: CursorRunningTurn;
    }): Effect.Effect<
      {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdout: string;
        readonly stderr: string;
        readonly interrupted: boolean;
      },
      ProviderAdapterRequestError
    > =>
      Effect.tryPromise({
        try: () =>
          new Promise<{
            readonly code: number | null;
            readonly signal: NodeJS.Signals | null;
            readonly stdout: string;
            readonly stderr: string;
            readonly interrupted: boolean;
          }>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            let settled = false;

            const finish = (finalize: () => void) => {
              if (settled) {
                return;
              }
              settled = true;
              finalize();
            };

            const child = spawn(input.binaryPath, [...input.args], {
              cwd: input.cwd,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
            });
            input.runningTurn.process = child;

            child.stdout?.on("data", (chunk: Buffer | string) => {
              stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
            });
            child.stderr?.on("data", (chunk: Buffer | string) => {
              stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
            });
            child.once("error", (error) => {
              finish(() => {
                reject(
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "CursorAdapter.sendTurn",
                    detail: toMessage(error, "Failed to spawn Cursor CLI process."),
                    cause: error,
                  }),
                );
              });
            });
            child.once("close", (code, signal) => {
              finish(() => {
                resolve({
                  code,
                  signal,
                  stdout,
                  stderr,
                  interrupted: input.runningTurn.interrupted,
                });
              });
            });
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "CursorAdapter.sendTurn",
            detail: toMessage(cause, "Failed to run Cursor CLI command."),
            cause,
          }),
      });

    const runTurn = (input: {
      readonly context: CursorSessionContext;
      readonly turnInput: ProviderSendTurnInput;
      readonly turnId: TurnId;
      readonly itemId: RuntimeItemId;
    }): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const threadId = input.context.session.threadId;

        yield* Effect.gen(function* () {
          const cwd = input.context.session.cwd?.trim() || process.cwd();
          const rawPrompt = input.turnInput.input?.trim() ?? "";
          const interactionMode = input.turnInput.interactionMode ?? "default";
          const attachmentContext = buildAttachmentContext({
            attachmentsDir: serverConfig.attachmentsDir,
            attachments: input.turnInput.attachments ?? [],
          });
          const prompt = buildPromptWithHistory({
            turns: input.context.turns,
            prompt: rawPrompt,
            attachmentContext,
            interactionMode,
          });
          const model =
            input.turnInput.model?.trim() || input.context.session.model || DEFAULT_CURSOR_MODEL;
          const binaryPath = input.context.binaryPath;
          const args = ["-p", prompt, "--force", "--output-format", "text", "--model", model];

          yield* logNativeEvent(
            {
              type: "cursor.turn.command",
              threadId,
              turnId: input.turnId,
              binaryPath,
              cwd,
              args,
            },
            threadId,
          );

          const runningTurn = input.context.runningTurn;
          if (!runningTurn || runningTurn.turnId !== input.turnId) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "CursorAdapter.sendTurn",
              detail: "Turn lifecycle state was lost before Cursor process startup.",
            });
          }

          const execution = yield* executeCursorTurnCommand({
            threadId,
            turnId: input.turnId,
            binaryPath,
            args,
            cwd,
            runningTurn,
          });

          yield* logNativeEvent(
            {
              type: "cursor.turn.result",
              threadId,
              turnId: input.turnId,
              code: execution.code,
              signal: execution.signal,
              interrupted: execution.interrupted,
              stdoutLength: execution.stdout.length,
              stderrLength: execution.stderr.length,
            },
            threadId,
          );

          const finishAt = nowIso();
          if (execution.interrupted) {
            yield* emitRuntimeEvent({
              type: "turn.aborted",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                reason: "Turn interrupted",
              },
            });
            yield* emitRuntimeEvent({
              type: "turn.completed",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                state: "interrupted",
                stopReason: "interrupted",
              },
            });
            input.context.session = {
              ...input.context.session,
              status: "ready",
              activeTurnId: undefined,
              updatedAt: finishAt,
            };
            yield* emitRuntimeEvent({
              type: "session.state.changed",
              ...makeRuntimeEventBase({ threadId }),
              payload: {
                state: "ready",
                reason: "Turn interrupted",
              },
            });
            return;
          }

          if (execution.code !== 0) {
            const rawMessage =
              execution.stderr.trim() ||
              execution.stdout.trim() ||
              `Cursor CLI exited with code ${execution.code ?? "unknown"}.`;
            const message = normalizeCursorFailureMessage(rawMessage);
            yield* emitRuntimeEvent({
              type: "runtime.error",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                class: "provider_error",
                message,
              },
            });
            yield* emitRuntimeEvent({
              type: "turn.completed",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                state: "failed",
                errorMessage: message,
              },
            });
            input.context.session = {
              ...input.context.session,
              status: "error",
              activeTurnId: undefined,
              updatedAt: finishAt,
              lastError: message,
            };
            yield* emitRuntimeEvent({
              type: "session.state.changed",
              ...makeRuntimeEventBase({ threadId }),
              payload: {
                state: "error",
                reason: message,
              },
            });
            return;
          }

          const parsed = parseCursorOutput({
            stdout: execution.stdout,
            stderr: execution.stderr,
          });
          const response = parsed.response.trim();
          const error = parsed.error ? normalizeCursorFailureMessage(parsed.error) : undefined;
          if (!response && error) {
            yield* emitRuntimeEvent({
              type: "runtime.error",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                class: "provider_error",
                message: error,
              },
            });
            yield* emitRuntimeEvent({
              type: "turn.completed",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
              payload: {
                state: "failed",
                errorMessage: error,
              },
            });
            input.context.session = {
              ...input.context.session,
              status: "error",
              activeTurnId: undefined,
              updatedAt: finishAt,
              lastError: error,
            };
            yield* emitRuntimeEvent({
              type: "session.state.changed",
              ...makeRuntimeEventBase({ threadId }),
              payload: {
                state: "error",
                reason: error,
              },
            });
            return;
          }

          if (response.length > 0) {
            yield* emitRuntimeEvent({
              type: "content.delta",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId, itemId: input.itemId }),
              payload: {
                streamKind: "assistant_text",
                delta: response,
              },
            });
            yield* emitRuntimeEvent({
              type: "item.completed",
              ...makeRuntimeEventBase({ threadId, turnId: input.turnId, itemId: input.itemId }),
              payload: {
                itemType: "assistant_message",
                status: "completed",
                detail: response,
              },
            });
            if (interactionMode === "plan") {
              yield* emitRuntimeEvent({
                type: "turn.proposed.completed",
                ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
                payload: {
                  planMarkdown: response,
                },
              });
            }
          }

          input.context.turns.push({
            id: input.turnId,
            prompt: rawPrompt,
            response,
            createdAt: finishAt,
            items: createCursorTurnItems(rawPrompt, response),
          });

          yield* emitRuntimeEvent({
            type: "turn.completed",
            ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
            payload: {
              state: "completed",
              stopReason: "completed",
            },
          });

          input.context.session = {
            ...input.context.session,
            status: "ready",
            activeTurnId: undefined,
            updatedAt: finishAt,
            ...(input.turnInput.model?.trim() ? { model: input.turnInput.model.trim() } : {}),
          };
          yield* emitRuntimeEvent({
            type: "session.state.changed",
            ...makeRuntimeEventBase({ threadId }),
            payload: {
              state: "ready",
            },
          });
        }).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                const rawMessage = toMessage(error, "Cursor turn failed.");
                const message = normalizeCursorFailureMessage(rawMessage);
                const finishAt = nowIso();
                yield* emitRuntimeEvent({
                  type: "runtime.error",
                  ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
                  payload: {
                    class: "provider_error",
                    message,
                  },
                });
                yield* emitRuntimeEvent({
                  type: "turn.completed",
                  ...makeRuntimeEventBase({ threadId, turnId: input.turnId }),
                  payload: {
                    state: "failed",
                    errorMessage: message,
                  },
                });
                input.context.session = {
                  ...input.context.session,
                  status: "error",
                  activeTurnId: undefined,
                  updatedAt: finishAt,
                  lastError: message,
                };
                yield* emitRuntimeEvent({
                  type: "session.state.changed",
                  ...makeRuntimeEventBase({ threadId }),
                  payload: {
                    state: "error",
                    reason: message,
                  },
                });
              }),
            onSuccess: () => Effect.void,
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (input.context.runningTurn?.turnId === input.turnId) {
              input.context.runningTurn = null;
            }
          }),
        ),
      );

    const sendTurn: CursorAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(input.threadId);
        if (context.session.status === "closed") {
          return yield* toSessionClosed(input.threadId);
        }
        if (context.runningTurn) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "CursorAdapter.sendTurn",
            detail: "A Cursor turn is already running for this thread.",
          });
        }

        const turnId = TurnId.makeUnsafe(`cursor-turn-${crypto.randomUUID()}`);
        const itemId = RuntimeItemId.makeUnsafe(`cursor-item-${crypto.randomUUID()}`);
        const startedAt = nowIso();
        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: startedAt,
          ...(input.model?.trim() ? { model: input.model.trim() } : {}),
        };
        context.runningTurn = {
          turnId,
          interactionMode: input.interactionMode ?? "default",
          itemId,
          process: null,
          interrupted: false,
        };

        yield* emitRuntimeEvent({
          type: "turn.started",
          ...makeRuntimeEventBase({ threadId: input.threadId, turnId }),
          payload: context.session.model ? { model: context.session.model } : {},
        });
        yield* emitRuntimeEvent({
          type: "session.state.changed",
          ...makeRuntimeEventBase({ threadId: input.threadId, turnId }),
          payload: {
            state: "running",
          },
        });

        yield* runTurn({
          context,
          turnInput: input,
          turnId,
          itemId,
        }).pipe(Effect.forkDetach);

        return {
          threadId: input.threadId,
          turnId,
        };
      });

    const interruptTurn: CursorAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(threadId);
        const runningTurn = context.runningTurn;
        if (!runningTurn) {
          return;
        }
        if (turnId && runningTurn.turnId !== turnId) {
          return;
        }
        runningTurn.interrupted = true;
        if (runningTurn.process && !runningTurn.process.killed) {
          runningTurn.process.kill("SIGTERM");
        }
      });

    const respondToRequest: CursorAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "CursorAdapter.respondToRequest",
          detail: `Cursor has no pending approval request '${requestId}' for thread '${threadId}'.`,
          cause: { decision },
        }),
      );

    const respondToUserInput: CursorAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "CursorAdapter.respondToUserInput",
          detail: `Cursor has no pending user-input request '${requestId}' for thread '${threadId}'.`,
          cause: { answers },
        }),
      );

    const stopSession: CursorAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(threadId);
        context.runningTurn?.process?.kill("SIGTERM");
        const closedAt = nowIso();
        context.session = {
          ...context.session,
          status: "closed",
          activeTurnId: undefined,
          updatedAt: closedAt,
        };
        sessions.delete(threadId);
        yield* emitRuntimeEvent({
          type: "session.exited",
          ...makeRuntimeEventBase({ threadId }),
          payload: {
            reason: "Session stopped",
            exitKind: "graceful",
            recoverable: true,
          },
        });
      });

    const listSessions: CursorAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (session) => session.session));

    const hasSession: CursorAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: CursorAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(threadId);
        return {
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: turn.items,
          })),
        };
      });

    const rollbackThread: CursorAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(threadId);
        if (context.runningTurn) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "CursorAdapter.rollbackThread",
            detail: "Cannot roll back while a Cursor turn is running.",
          });
        }
        const safeNumTurns = Math.max(0, Math.floor(numTurns));
        if (safeNumTurns > 0) {
          context.turns.splice(Math.max(0, context.turns.length - safeNumTurns), safeNumTurns);
        }
        return {
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: turn.items,
          })),
        };
      });

    const stopAll: CursorAdapterShape["stopAll"] = () =>
      Effect.sync(() => {
        for (const context of sessions.values()) {
          context.runningTurn?.process?.kill("SIGTERM");
        }
        sessions.clear();
      });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(Effect.ignore, Effect.andThen(Queue.shutdown(runtimeEventQueue))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies CursorAdapterShape;
  });

export const CursorAdapterLive = Layer.effect(CursorAdapter, makeCursorAdapter());

export function makeCursorAdapterLive(options?: CursorAdapterLiveOptions) {
  return Layer.effect(CursorAdapter, makeCursorAdapter(options));
}
