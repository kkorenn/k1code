import type {
  ContextMenuItem,
  DesktopBridge,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@k1tools/contracts";

import { showContextMenuFallback } from "./contextMenuFallback";

type TauriCoreModule = typeof import("@tauri-apps/api/core");
type TauriEventModule = typeof import("@tauri-apps/api/event");
type UnlistenFn = () => void;

const MENU_ACTION_EVENT = "desktop://menu-action";
const UPDATE_STATE_EVENT = "desktop://update-state";
const WS_QUERY_PARAM = "k1ws";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauriRuntime =
  typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";

let coreModulePromise: Promise<TauriCoreModule> | null = null;
let eventModulePromise: Promise<TauriEventModule> | null = null;

function loadCoreModule(): Promise<TauriCoreModule> {
  if (coreModulePromise) {
    return coreModulePromise;
  }
  coreModulePromise = import("@tauri-apps/api/core");
  return coreModulePromise;
}

function loadEventModule(): Promise<TauriEventModule> {
  if (eventModulePromise) {
    return eventModulePromise;
  }
  eventModulePromise = import("@tauri-apps/api/event");
  return eventModulePromise;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await loadCoreModule();
  return core.invoke<T>(command, args);
}

function resolveWsUrlFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(WS_QUERY_PARAM);
    if (typeof fromQuery === "string" && fromQuery.length > 0) {
      return fromQuery;
    }
  } catch {
    // Ignore URL parsing failures and fall through to env.
  }

  const envWsUrl = import.meta.env.VITE_WS_URL;
  if (typeof envWsUrl === "string" && envWsUrl.length > 0) {
    return envWsUrl;
  }

  return null;
}

const menuActionListeners = new Set<(action: string) => void>();
let menuUnlistenPromise: Promise<UnlistenFn> | null = null;

function ensureMenuActionSubscription(): void {
  if (menuUnlistenPromise) {
    return;
  }

  menuUnlistenPromise = loadEventModule().then((eventModule) =>
    eventModule.listen<string>(MENU_ACTION_EVENT, (event) => {
      if (typeof event.payload !== "string") {
        return;
      }
      for (const listener of menuActionListeners) {
        try {
          listener(event.payload);
        } catch {
          // Swallow listener errors.
        }
      }
    }),
  );
}

function teardownMenuActionSubscriptionIfUnused(): void {
  if (menuActionListeners.size > 0 || menuUnlistenPromise === null) {
    return;
  }

  const promise = menuUnlistenPromise;
  menuUnlistenPromise = null;
  void promise.then((unlisten) => {
    unlisten();
  });
}

const updateStateListeners = new Set<(state: DesktopUpdateState) => void>();
let updateStateUnlistenPromise: Promise<UnlistenFn> | null = null;

function ensureUpdateStateSubscription(): void {
  if (updateStateUnlistenPromise) {
    return;
  }

  updateStateUnlistenPromise = loadEventModule().then((eventModule) =>
    eventModule.listen<DesktopUpdateState>(UPDATE_STATE_EVENT, (event) => {
      if (typeof event.payload !== "object" || event.payload === null) {
        return;
      }
      for (const listener of updateStateListeners) {
        try {
          listener(event.payload);
        } catch {
          // Swallow listener errors.
        }
      }
    }),
  );
}

function teardownUpdateStateSubscriptionIfUnused(): void {
  if (updateStateListeners.size > 0 || updateStateUnlistenPromise === null) {
    return;
  }

  const promise = updateStateUnlistenPromise;
  updateStateUnlistenPromise = null;
  void promise.then((unlisten) => {
    unlisten();
  });
}

const tauriDesktopBridge: DesktopBridge = {
  getWsUrl: () => resolveWsUrlFromLocation(),
  pickFolder: () => invokeCommand<string | null>("pick_folder"),
  getDocumentsPath: () => invokeCommand<string | null>("get_documents_path"),
  confirm: (message: string) => invokeCommand<boolean>("confirm", { message }),
  setTheme: (theme: DesktopTheme) => invokeCommand<void>("set_theme", { theme }),
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => showContextMenuFallback(items, position),
  openExternal: (url: string) => invokeCommand<boolean>("open_external", { url }),
  onMenuAction: (listener) => {
    menuActionListeners.add(listener);
    ensureMenuActionSubscription();
    return () => {
      menuActionListeners.delete(listener);
      teardownMenuActionSubscriptionIfUnused();
    };
  },
  getUpdateState: () => invokeCommand<DesktopUpdateState>("get_update_state"),
  downloadUpdate: () => invokeCommand<DesktopUpdateActionResult>("download_update"),
  installUpdate: () => invokeCommand<DesktopUpdateActionResult>("install_update"),
  onUpdateState: (listener) => {
    updateStateListeners.add(listener);
    ensureUpdateStateSubscription();
    return () => {
      updateStateListeners.delete(listener);
      teardownUpdateStateSubscriptionIfUnused();
    };
  },
};

if (isTauriRuntime && window.desktopBridge === undefined) {
  window.desktopBridge = tauriDesktopBridge;
}
