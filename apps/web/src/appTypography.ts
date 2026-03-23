import { useLayoutEffect } from "react";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  type TerminalFontSize,
  type UiFontSize,
  useAppSettings,
} from "./appSettings";

export const UI_FONT_SIZE_OPTIONS: ReadonlyArray<{ value: UiFontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

export const TERMINAL_FONT_SIZE_OPTIONS: ReadonlyArray<{
  value: TerminalFontSize;
  label: string;
}> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" },
];

const DEFAULT_MONO_FONT_FAMILY =
  '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

const UI_FONT_SIZE_PX: Record<UiFontSize, number> = {
  sm: 15,
  md: 16,
  lg: 17,
};

const TERMINAL_FONT_SIZE_PX: Record<TerminalFontSize, number> = {
  sm: 11,
  md: 12,
  lg: 13,
  xl: 14,
};

export function normalizeFontFamilyOverride(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function getUiFontSizePx(value: UiFontSize): number {
  return UI_FONT_SIZE_PX[value];
}

export function getTerminalFontSizePx(value: TerminalFontSize): number {
  return TERMINAL_FONT_SIZE_PX[value];
}

function setRootStyleProperty(name: string, value: string | null): void {
  if (value === null) {
    document.documentElement.style.removeProperty(name);
    return;
  }

  document.documentElement.style.setProperty(name, value);
}

function parsePx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function useAppTypography(): void {
  const { settings } = useAppSettings();

  useLayoutEffect(() => {
    setRootStyleProperty("--app-ui-font-size", `${getUiFontSizePx(settings.uiFontSize)}px`);
    setRootStyleProperty(
      "--app-terminal-font-size",
      `${getTerminalFontSizePx(settings.terminalFontSize)}px`,
    );
    setRootStyleProperty(
      "--app-ui-font-family",
      normalizeFontFamilyOverride(settings.uiFontFamily),
    );
    setRootStyleProperty(
      "--app-mono-font-family",
      normalizeFontFamilyOverride(settings.monoFontFamily),
    );
  }, [
    settings.monoFontFamily,
    settings.terminalFontSize,
    settings.uiFontFamily,
    settings.uiFontSize,
  ]);
}

export function readTerminalTypographyFromApp(): { fontFamily: string; fontSize: number } {
  const rootStyles = getComputedStyle(document.documentElement);
  const fontFamily =
    rootStyles.getPropertyValue("--app-mono-font-family").trim() || DEFAULT_MONO_FONT_FAMILY;
  const fontSize = parsePx(
    rootStyles.getPropertyValue("--app-terminal-font-size"),
    getTerminalFontSizePx(DEFAULT_TERMINAL_FONT_SIZE),
  );

  return {
    fontFamily,
    fontSize,
  };
}
