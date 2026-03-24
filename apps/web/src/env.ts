/**
 * True when running inside a desktop runtime bridge, false in a regular browser.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);
