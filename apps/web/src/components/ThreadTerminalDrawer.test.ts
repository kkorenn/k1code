import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  applyTerminalAppearanceUpdate,
  resolveTerminalSelectionActionPosition,
  shouldHandleTerminalSelectionMouseUp,
  syncTerminalGeometryWithBackend,
  terminalSelectionActionDelayForClickCount,
} from "./ThreadTerminalDrawer";

describe("resolveTerminalSelectionActionPosition", () => {
  it("prefers the selection rect over the last pointer position", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: { right: 260, bottom: 140 },
        pointer: { x: 520, y: 200 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 260,
      y: 144,
    });
  });

  it("falls back to the pointer position when no selection rect is available", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 180, y: 130 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 180,
      y: 130,
    });
  });

  it("clamps the pointer fallback into the terminal drawer bounds", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 720, y: 340 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 600,
      y: 270,
    });

    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 40, y: 20 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("delays multi-click selection actions so triple-click selection can complete", () => {
    expect(terminalSelectionActionDelayForClickCount(1)).toBe(0);
    expect(terminalSelectionActionDelayForClickCount(2)).toBe(260);
    expect(terminalSelectionActionDelayForClickCount(3)).toBe(260);
  });

  it("only handles mouseup when the selection gesture started in the terminal", () => {
    expect(shouldHandleTerminalSelectionMouseUp(true, 0)).toBe(true);
    expect(shouldHandleTerminalSelectionMouseUp(false, 0)).toBe(false);
    expect(shouldHandleTerminalSelectionMouseUp(true, 1)).toBe(false);
  });
});

describe("applyTerminalAppearanceUpdate", () => {
  it("refreshes in place when only the theme changes", () => {
    const refresh = vi.fn();
    const terminal = {
      options: {
        theme: { background: "#000000" },
        fontFamily: "Menlo, monospace",
        fontSize: 12,
      },
      rows: 30,
      refresh,
    };

    const result = applyTerminalAppearanceUpdate({
      terminal,
      theme: { background: "#ffffff" },
      typography: { fontFamily: "Menlo, monospace", fontSize: 12 },
    });

    expect(result).toBe("refresh");
    expect(terminal.options.theme).toEqual({ background: "#ffffff" });
    expect(refresh).toHaveBeenCalledWith(0, 29);
  });

  it("requests geometry sync when the terminal font changes", () => {
    const refresh = vi.fn();
    const terminal = {
      options: {
        theme: { background: "#000000" },
        fontFamily: "Menlo, monospace",
        fontSize: 12,
      },
      rows: 30,
      refresh,
    };

    const result = applyTerminalAppearanceUpdate({
      terminal,
      theme: { background: "#000000" },
      typography: { fontFamily: '"SF Mono", Menlo, monospace', fontSize: 14 },
    });

    expect(result).toBe("geometry");
    expect(terminal.options.fontFamily).toBe('"SF Mono", Menlo, monospace');
    expect(terminal.options.fontSize).toBe(14);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("syncTerminalGeometryWithBackend", () => {
  it("uses post-fit geometry and keeps the terminal pinned to the bottom when already at the bottom", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const resize = vi.fn().mockResolvedValue(undefined);
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: { active: { viewportY: 12, baseY: 12 } },
      cols: 80,
      rows: 24,
      scrollToBottom,
    };
    const fitAddon = {
      fit: vi.fn(() => {
        terminal.cols = 120;
        terminal.rows = 40;
      }),
    };

    syncTerminalGeometryWithBackend({
      api: { terminal: { resize } },
      terminal,
      fitAddon,
      threadId,
      terminalId: "default",
    });

    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({
      threadId,
      terminalId: "default",
      cols: 120,
      rows: 40,
    });
  });

  it("does not force-scroll when the terminal is not at the bottom", () => {
    const threadId = ThreadId.makeUnsafe("thread-2");
    const resize = vi.fn().mockResolvedValue(undefined);
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: { active: { viewportY: 4, baseY: 12 } },
      cols: 90,
      rows: 30,
      scrollToBottom,
    };
    const fitAddon = {
      fit: vi.fn(),
    };

    syncTerminalGeometryWithBackend({
      api: { terminal: { resize } },
      terminal,
      fitAddon,
      threadId,
      terminalId: "secondary",
    });

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith({
      threadId,
      terminalId: "secondary",
      cols: 90,
      rows: 30,
    });
  });
});
