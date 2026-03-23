import { describe, expect, it } from "vitest";

import {
  getTerminalFontSizePx,
  getUiFontSizePx,
  normalizeFontFamilyOverride,
} from "./appTypography";

describe("normalizeFontFamilyOverride", () => {
  it("treats blank and whitespace-only values as no override", () => {
    expect(normalizeFontFamilyOverride("")).toBeNull();
    expect(normalizeFontFamilyOverride("   ")).toBeNull();
    expect(normalizeFontFamilyOverride(undefined)).toBeNull();
  });

  it("trims non-empty font family overrides", () => {
    expect(normalizeFontFamilyOverride("  Inter, system-ui, sans-serif  ")).toBe(
      "Inter, system-ui, sans-serif",
    );
  });
});

describe("font size helpers", () => {
  it("maps interface sizes to conservative root pixel values", () => {
    expect(getUiFontSizePx("sm")).toBe(15);
    expect(getUiFontSizePx("md")).toBe(16);
    expect(getUiFontSizePx("lg")).toBe(17);
  });

  it("maps terminal sizes to xterm pixel values", () => {
    expect(getTerminalFontSizePx("sm")).toBe(11);
    expect(getTerminalFontSizePx("md")).toBe(12);
    expect(getTerminalFontSizePx("lg")).toBe(13);
    expect(getTerminalFontSizePx("xl")).toBe(14);
  });
});
