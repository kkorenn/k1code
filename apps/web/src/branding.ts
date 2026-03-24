export const APP_BASE_NAME = "K1 Code";
export const APP_STAGE_LABEL = import.meta.env.DEV ? "Dev" : "Beta";
export const APP_DISPLAY_NAME = `${APP_BASE_NAME} (${APP_STAGE_LABEL})`;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
export const APP_STAGE_BADGE_LABEL = import.meta.env.DEV ? APP_STAGE_LABEL : `Beta v${APP_VERSION}`;
