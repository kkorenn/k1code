import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it, assert } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  checkClaudeProviderStatus,
  checkCodexProviderStatus,
  checkGeminiProviderStatus,
  hasCustomModelProvider,
  parseAuthStatusFromOutput,
  parseClaudeAuthStatusFromOutput,
  readCodexConfigModelProvider,
} from "./ProviderHealth";

// ── Test helpers ────────────────────────────────────────────────────

const encoder = new TextEncoder();

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (args: ReadonlyArray<string>) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.args)));
    }),
  );
}

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

/**
 * Create a temporary CODEX_HOME scoped to the current Effect test.
 * Cleanup is registered in the test scope rather than via Vitest hooks.
 */
function withTempCodexHome(configContent?: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tmpDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "k1-test-codex-" });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const originalCodexHome = process.env.CODEX_HOME;
        process.env.CODEX_HOME = tmpDir;
        return originalCodexHome;
      }),
      (originalCodexHome) =>
        Effect.sync(() => {
          if (originalCodexHome !== undefined) {
            process.env.CODEX_HOME = originalCodexHome;
          } else {
            delete process.env.CODEX_HOME;
          }
        }),
    );

    if (configContent !== undefined) {
      yield* fileSystem.writeFileString(path.join(tmpDir, "config.toml"), configContent);
    }

    return { tmpDir } as const;
  });
}

/**
 * Create a temporary HOME scoped to the current Effect test for Gemini auth checks.
 * Optionally writes `~/.gemini/settings.json` and `~/.gemini/oauth_creds.json`.
 */
function withTempGeminiHome(options?: {
  readonly settingsContent?: string;
  readonly oauthCredsContent?: string;
  readonly geminiApiKey?: string;
}) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tmpDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "k1-test-gemini-" });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        const originalGeminiApiKey = process.env.GEMINI_API_KEY;
        const originalVertexAi = process.env.GOOGLE_GENAI_USE_VERTEXAI;
        const originalGca = process.env.GOOGLE_GENAI_USE_GCA;

        process.env.HOME = tmpDir;
        process.env.USERPROFILE = tmpDir;
        if (options?.geminiApiKey !== undefined) {
          process.env.GEMINI_API_KEY = options.geminiApiKey;
        } else {
          delete process.env.GEMINI_API_KEY;
        }
        delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
        delete process.env.GOOGLE_GENAI_USE_GCA;

        return {
          originalHome,
          originalUserProfile,
          originalGeminiApiKey,
          originalVertexAi,
          originalGca,
        } as const;
      }),
      (originals) =>
        Effect.sync(() => {
          if (originals.originalHome !== undefined) process.env.HOME = originals.originalHome;
          else delete process.env.HOME;
          if (originals.originalUserProfile !== undefined)
            process.env.USERPROFILE = originals.originalUserProfile;
          else delete process.env.USERPROFILE;

          if (originals.originalGeminiApiKey !== undefined)
            process.env.GEMINI_API_KEY = originals.originalGeminiApiKey;
          else delete process.env.GEMINI_API_KEY;

          if (originals.originalVertexAi !== undefined)
            process.env.GOOGLE_GENAI_USE_VERTEXAI = originals.originalVertexAi;
          else delete process.env.GOOGLE_GENAI_USE_VERTEXAI;

          if (originals.originalGca !== undefined)
            process.env.GOOGLE_GENAI_USE_GCA = originals.originalGca;
          else delete process.env.GOOGLE_GENAI_USE_GCA;
        }),
    );

    const geminiDir = path.join(tmpDir, ".gemini");
    yield* fileSystem.makeDirectory(geminiDir, { recursive: true });
    if (options?.settingsContent !== undefined) {
      yield* fileSystem.writeFileString(
        path.join(geminiDir, "settings.json"),
        options.settingsContent,
      );
    }
    if (options?.oauthCredsContent !== undefined) {
      yield* fileSystem.writeFileString(
        path.join(geminiDir, "oauth_creds.json"),
        options.oauthCredsContent,
      );
    }

    return { tmpDir } as const;
  });
}

it.layer(NodeServices.layer)("ProviderHealth", (it) => {
  // ── checkCodexProviderStatus tests ────────────────────────────────
  //
  // These tests control CODEX_HOME to ensure the custom-provider detection
  // in hasCustomModelProvider() does not interfere with the auth-probe
  // path being tested.

  describe("checkCodexProviderStatus", () => {
    it.effect("returns ready when codex is installed and authenticated", () =>
      Effect.gen(function* () {
        // Point CODEX_HOME at an empty tmp dir (no config.toml) so the
        // default code path (OpenAI provider, auth probe runs) is exercised.
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "authenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            if (joined === "login status") return { stdout: "Logged in\n", stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unavailable when codex is missing", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, false);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(status.message, "Codex CLI (`codex`) is not installed or not on PATH.");
      }).pipe(Effect.provide(failingSpawnerLayer("spawn codex ENOENT"))),
    );

    it.effect("returns unavailable when codex is below the minimum supported version", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, false);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(
          status.message,
          "Codex CLI v0.36.0 is too old for K1 Code. Upgrade to v0.37.0 or newer and restart K1 Code.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 0.36.0\n", stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unauthenticated when auth probe reports login required", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unauthenticated");
        assert.strictEqual(
          status.message,
          "Codex CLI is not authenticated. Run `codex login` and try again.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            if (joined === "login status") {
              return { stdout: "", stderr: "Not logged in. Run codex login.", code: 1 };
            }
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unauthenticated when login status output includes 'not logged in'", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unauthenticated");
        assert.strictEqual(
          status.message,
          "Codex CLI is not authenticated. Run `codex login` and try again.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            if (joined === "login status")
              return { stdout: "Not logged in\n", stderr: "", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns warning when login status command is unsupported", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "warning");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(
          status.message,
          "Codex CLI authentication status command is unavailable in this Codex version.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            if (joined === "login status") {
              return { stdout: "", stderr: "error: unknown command 'login'", code: 2 };
            }
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );
  });

  // ── Custom model provider: checkCodexProviderStatus integration ───

  describe("checkCodexProviderStatus with custom model provider", () => {
    it.effect("skips auth probe and returns ready when a custom model provider is configured", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome(
          [
            'model_provider = "portkey"',
            "",
            "[model_providers.portkey]",
            'base_url = "https://api.portkey.ai/v1"',
            'env_key = "PORTKEY_API_KEY"',
          ].join("\n"),
        );
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.provider, "codex");
        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(
          status.message,
          "Using a custom Codex model provider; OpenAI login check skipped.",
        );
      }).pipe(
        Effect.provide(
          // The spawner only handles --version; if the test attempts
          // "login status" the throw proves the auth probe was NOT skipped.
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            throw new Error(`Auth probe should have been skipped but got args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("still reports error when codex CLI is missing even with custom provider", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome(
          [
            'model_provider = "portkey"',
            "",
            "[model_providers.portkey]",
            'base_url = "https://api.portkey.ai/v1"',
            'env_key = "PORTKEY_API_KEY"',
          ].join("\n"),
        );
        const status = yield* checkCodexProviderStatus;
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, false);
      }).pipe(Effect.provide(failingSpawnerLayer("spawn codex ENOENT"))),
    );
  });

  describe("checkCodexProviderStatus with openai model provider", () => {
    it.effect("still runs auth probe when model_provider is openai", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "openai"\n');
        const status = yield* checkCodexProviderStatus;
        // The auth probe runs and sees "not logged in" → error
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.authStatus, "unauthenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
            if (joined === "login status")
              return { stdout: "Not logged in\n", stderr: "", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );
  });

  // ── parseAuthStatusFromOutput pure tests ──────────────────────────

  describe("parseAuthStatusFromOutput", () => {
    it("exit code 0 with no auth markers is ready", () => {
      const parsed = parseAuthStatusFromOutput({ stdout: "OK\n", stderr: "", code: 0 });
      assert.strictEqual(parsed.status, "ready");
      assert.strictEqual(parsed.authStatus, "authenticated");
    });

    it("JSON with authenticated=false is unauthenticated", () => {
      const parsed = parseAuthStatusFromOutput({
        stdout: '[{"authenticated":false}]\n',
        stderr: "",
        code: 0,
      });
      assert.strictEqual(parsed.status, "error");
      assert.strictEqual(parsed.authStatus, "unauthenticated");
    });

    it("JSON without auth marker is warning", () => {
      const parsed = parseAuthStatusFromOutput({
        stdout: '[{"ok":true}]\n',
        stderr: "",
        code: 0,
      });
      assert.strictEqual(parsed.status, "warning");
      assert.strictEqual(parsed.authStatus, "unknown");
    });
  });

  // ── readCodexConfigModelProvider tests ─────────────────────────────

  describe("readCodexConfigModelProvider", () => {
    it.effect("returns undefined when config file does not exist", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        assert.strictEqual(yield* readCodexConfigModelProvider, undefined);
      }),
    );

    it.effect("returns undefined when config has no model_provider key", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model = "gpt-5-codex"\n');
        assert.strictEqual(yield* readCodexConfigModelProvider, undefined);
      }),
    );

    it.effect("returns the provider when model_provider is set at top level", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model = "gpt-5-codex"\nmodel_provider = "portkey"\n');
        assert.strictEqual(yield* readCodexConfigModelProvider, "portkey");
      }),
    );

    it.effect("returns openai when model_provider is openai", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "openai"\n');
        assert.strictEqual(yield* readCodexConfigModelProvider, "openai");
      }),
    );

    it.effect("ignores model_provider inside section headers", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome(
          [
            'model = "gpt-5-codex"',
            "",
            "[model_providers.portkey]",
            'base_url = "https://api.portkey.ai/v1"',
            'model_provider = "should-be-ignored"',
            "",
          ].join("\n"),
        );
        assert.strictEqual(yield* readCodexConfigModelProvider, undefined);
      }),
    );

    it.effect("handles comments and whitespace", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome(
          [
            "# This is a comment",
            "",
            '  model_provider = "azure"  ',
            "",
            "[profiles.deep-review]",
            'model = "gpt-5-pro"',
          ].join("\n"),
        );
        assert.strictEqual(yield* readCodexConfigModelProvider, "azure");
      }),
    );

    it.effect("handles single-quoted values in TOML", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome("model_provider = 'mistral'\n");
        assert.strictEqual(yield* readCodexConfigModelProvider, "mistral");
      }),
    );
  });

  // ── hasCustomModelProvider tests ───────────────────────────────────

  describe("hasCustomModelProvider", () => {
    it.effect("returns false when no config file exists", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome();
        assert.strictEqual(yield* hasCustomModelProvider, false);
      }),
    );

    it.effect("returns false when model_provider is not set", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model = "gpt-5-codex"\n');
        assert.strictEqual(yield* hasCustomModelProvider, false);
      }),
    );

    it.effect("returns false when model_provider is openai", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "openai"\n');
        assert.strictEqual(yield* hasCustomModelProvider, false);
      }),
    );

    it.effect("returns true when model_provider is portkey", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "portkey"\n');
        assert.strictEqual(yield* hasCustomModelProvider, true);
      }),
    );

    it.effect("returns true when model_provider is azure", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "azure"\n');
        assert.strictEqual(yield* hasCustomModelProvider, true);
      }),
    );

    it.effect("returns true when model_provider is ollama", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "ollama"\n');
        assert.strictEqual(yield* hasCustomModelProvider, true);
      }),
    );

    it.effect("returns true when model_provider is a custom proxy", () =>
      Effect.gen(function* () {
        yield* withTempCodexHome('model_provider = "my-company-proxy"\n');
        assert.strictEqual(yield* hasCustomModelProvider, true);
      }),
    );
  });

  // ── checkClaudeProviderStatus tests ──────────────────────────

  describe("checkClaudeProviderStatus", () => {
    it.effect("returns ready when claude is installed and authenticated", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "authenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
            if (joined === "auth status")
              return {
                stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n',
                stderr: "",
                code: 0,
              };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unavailable when claude is missing", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, false);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(
          status.message,
          "Claude Agent CLI (`claude`) is not installed or not on PATH.",
        );
      }).pipe(Effect.provide(failingSpawnerLayer("spawn claude ENOENT"))),
    );

    it.effect("returns error when version check fails with non-zero exit code", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, false);
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version")
              return { stdout: "", stderr: "Something went wrong", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unauthenticated when auth status reports not logged in", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unauthenticated");
        assert.strictEqual(
          status.message,
          "Claude is not authenticated. Run `claude auth login` and try again.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
            if (joined === "auth status")
              return {
                stdout: '{"loggedIn":false}\n',
                stderr: "",
                code: 1,
              };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unauthenticated when output includes 'not logged in'", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unauthenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
            if (joined === "auth status") return { stdout: "Not logged in\n", stderr: "", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns warning when auth status command is unsupported", () =>
      Effect.gen(function* () {
        const status = yield* checkClaudeProviderStatus;
        assert.strictEqual(status.provider, "claudeAgent");
        assert.strictEqual(status.status, "warning");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unknown");
        assert.strictEqual(
          status.message,
          "Claude Agent authentication status command is unavailable in this version of Claude.",
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
            if (joined === "auth status")
              return { stdout: "", stderr: "error: unknown command 'auth'", code: 2 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );
  });

  // ── parseClaudeAuthStatusFromOutput pure tests ────────────────────

  describe("checkGeminiProviderStatus", () => {
    it.effect("returns authenticated when Gemini auth settings are configured", () =>
      Effect.gen(function* () {
        yield* withTempGeminiHome({
          settingsContent: JSON.stringify(
            { security: { auth: { selectedType: "oauth-personal" } } },
            null,
            2,
          ),
          oauthCredsContent: '{"access_token":"test"}',
        });
        const status = yield* checkGeminiProviderStatus;
        assert.strictEqual(status.provider, "gemini");
        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "authenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "0.34.0\n", stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns unauthenticated when Gemini auth settings are missing", () =>
      Effect.gen(function* () {
        yield* withTempGeminiHome();
        const status = yield* checkGeminiProviderStatus;
        assert.strictEqual(status.provider, "gemini");
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "unauthenticated");
        assert.strictEqual(
          status.message,
          'Gemini is not authenticated. Run `gemini`, choose "Sign in with Google", and complete login (or set `GEMINI_API_KEY`), then try again.',
        );
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "0.34.0\n", stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );

    it.effect("returns authenticated when GEMINI_API_KEY is set", () =>
      Effect.gen(function* () {
        yield* withTempGeminiHome({ geminiApiKey: "test-key" });
        const status = yield* checkGeminiProviderStatus;
        assert.strictEqual(status.provider, "gemini");
        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.available, true);
        assert.strictEqual(status.authStatus, "authenticated");
      }).pipe(
        Effect.provide(
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "0.34.0\n", stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    );
  });

  describe("parseClaudeAuthStatusFromOutput", () => {
    it("exit code 0 with no auth markers is ready", () => {
      const parsed = parseClaudeAuthStatusFromOutput({ stdout: "OK\n", stderr: "", code: 0 });
      assert.strictEqual(parsed.status, "ready");
      assert.strictEqual(parsed.authStatus, "authenticated");
    });

    it("JSON with loggedIn=true is authenticated", () => {
      const parsed = parseClaudeAuthStatusFromOutput({
        stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n',
        stderr: "",
        code: 0,
      });
      assert.strictEqual(parsed.status, "ready");
      assert.strictEqual(parsed.authStatus, "authenticated");
    });

    it("JSON with loggedIn=false is unauthenticated", () => {
      const parsed = parseClaudeAuthStatusFromOutput({
        stdout: '{"loggedIn":false}\n',
        stderr: "",
        code: 0,
      });
      assert.strictEqual(parsed.status, "error");
      assert.strictEqual(parsed.authStatus, "unauthenticated");
    });

    it("JSON without auth marker is warning", () => {
      const parsed = parseClaudeAuthStatusFromOutput({
        stdout: '{"ok":true}\n',
        stderr: "",
        code: 0,
      });
      assert.strictEqual(parsed.status, "warning");
      assert.strictEqual(parsed.authStatus, "unknown");
    });
  });
});
