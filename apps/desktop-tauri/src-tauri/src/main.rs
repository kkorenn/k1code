#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::{distributions::Alphanumeric, Rng};
use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde::Serialize;
use std::env;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State, Theme, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const APP_DISPLAY_NAME: &str = "K1 Code";
const DEFAULT_BASE_DIR_NAME: &str = ".k1";
const DEFAULT_PORT: u16 = 3773;
const WS_QUERY_PARAM: &str = "k1ws";

#[derive(Debug)]
struct DesktopRuntimeState {
  backend_child: Mutex<Option<Child>>,
  ws_url: String,
  update_state: Mutex<DesktopUpdateState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateState {
  enabled: bool,
  status: String,
  current_version: String,
  host_arch: String,
  app_arch: String,
  running_under_arm64_translation: bool,
  available_version: Option<String>,
  downloaded_version: Option<String>,
  download_percent: Option<f64>,
  checked_at: Option<String>,
  message: Option<String>,
  error_context: Option<String>,
  can_retry: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateActionResult {
  accepted: bool,
  completed: bool,
  state: DesktopUpdateState,
}

fn normalize_arch(raw: &str) -> String {
  match raw {
    "aarch64" | "arm64" => "arm64".to_string(),
    "x86_64" | "x64" => "x64".to_string(),
    _ => "other".to_string(),
  }
}

fn initial_update_state(app: &AppHandle) -> DesktopUpdateState {
  let arch = normalize_arch(env::consts::ARCH);
  DesktopUpdateState {
    enabled: false,
    status: "disabled".to_string(),
    current_version: app.package_info().version.to_string(),
    host_arch: arch.clone(),
    app_arch: arch,
    running_under_arm64_translation: false,
    available_version: None,
    downloaded_version: None,
    download_percent: None,
    checked_at: None,
    message: Some("Tauri updater integration is not enabled yet.".to_string()),
    error_context: None,
    can_retry: false,
  }
}

fn resolve_base_dir() -> PathBuf {
  if let Ok(path) = env::var("K1CODE_HOME") {
    let trimmed = path.trim();
    if !trimmed.is_empty() {
      return PathBuf::from(trimmed);
    }
  }

  if let Some(home) = dirs::home_dir() {
    return home.join(DEFAULT_BASE_DIR_NAME);
  }

  PathBuf::from(format!("./{DEFAULT_BASE_DIR_NAME}"))
}

fn reserve_loopback_port() -> u16 {
  match TcpListener::bind("127.0.0.1:0") {
    Ok(listener) => listener
      .local_addr()
      .map(|address| address.port())
      .unwrap_or(DEFAULT_PORT),
    Err(_) => DEFAULT_PORT,
  }
}

fn generate_auth_token() -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(48)
    .map(char::from)
    .collect::<String>()
}

fn encode_query_value(value: &str) -> String {
  url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
}

fn resolve_repo_root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("../../..")
    .canonicalize()
    .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn resolve_backend_entry(app: &AppHandle) -> Result<PathBuf, String> {
  if cfg!(debug_assertions) {
    return Ok(resolve_repo_root().join("apps/server/dist/index.mjs"));
  }

  let resource_dir = app
    .path()
    .resource_dir()
    .map_err(|error| format!("failed to resolve resource dir: {error}"))?;
  Ok(resource_dir.join("server/dist/index.mjs"))
}

fn resolve_backend_cwd() -> PathBuf {
  if cfg!(debug_assertions) {
    return resolve_repo_root();
  }

  dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_node_executable(app: &AppHandle) -> PathBuf {
  if let Ok(custom) = env::var("K1CODE_TAURI_NODE_PATH") {
    let trimmed = custom.trim();
    if !trimmed.is_empty() {
      return PathBuf::from(trimmed);
    }
  }

  if cfg!(debug_assertions) {
    return PathBuf::from("node");
  }

  if let Ok(resource_dir) = app.path().resource_dir() {
    let candidates = [
      resource_dir.join("sidecars/node"),
      resource_dir.join("sidecars/node.exe"),
      resource_dir.join("node"),
      resource_dir.join("node.exe"),
    ];
    for candidate in candidates {
      if candidate.exists() {
        return candidate;
      }
    }
  }

  PathBuf::from("node")
}

fn spawn_backend(app: &AppHandle, port: u16, auth_token: &str) -> Result<Child, String> {
  let backend_entry = resolve_backend_entry(app)?;
  if !backend_entry.exists() {
    return Err(format!(
      "missing backend entry at {}. build apps/server first",
      backend_entry.display()
    ));
  }

  let base_dir = resolve_base_dir();
  let node_executable = resolve_node_executable(app);

  let mut command = Command::new(node_executable);
  command
    .arg(backend_entry)
    .current_dir(resolve_backend_cwd())
    .envs(env::vars())
    .env("K1CODE_MODE", "desktop")
    .env("K1CODE_NO_BROWSER", "1")
    .env("K1CODE_PORT", port.to_string())
    .env("K1CODE_HOME", base_dir)
    .env("K1CODE_AUTH_TOKEN", auth_token)
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit());

  command
    .spawn()
    .map_err(|error| format!("failed to spawn backend process: {error}"))
}

fn resolve_frontend_url(ws_url: &str) -> Result<WebviewUrl, String> {
  if let Ok(raw_dev_url) = env::var("VITE_DEV_SERVER_URL") {
    let trimmed = raw_dev_url.trim();
    if !trimmed.is_empty() {
      let mut url = Url::parse(trimmed)
        .map_err(|error| format!("invalid VITE_DEV_SERVER_URL '{trimmed}': {error}"))?;
      url.query_pairs_mut().append_pair(WS_QUERY_PARAM, ws_url);
      return Ok(WebviewUrl::External(url));
    }
  }

  let encoded_ws = encode_query_value(ws_url);
  Ok(WebviewUrl::App(
    format!("index.html?{WS_QUERY_PARAM}={encoded_ws}").into(),
  ))
}

fn build_runtime_state(app: &AppHandle) -> Result<DesktopRuntimeState, String> {
  let port = reserve_loopback_port();
  let auth_token = generate_auth_token();
  let ws_url = format!(
    "ws://127.0.0.1:{port}/?token={}",
    encode_query_value(&auth_token)
  );

  let child = spawn_backend(app, port, &auth_token)?;

  Ok(DesktopRuntimeState {
    backend_child: Mutex::new(Some(child)),
    ws_url,
    update_state: Mutex::new(initial_update_state(app)),
  })
}

fn create_main_window(app: &AppHandle, ws_url: &str) -> Result<(), String> {
  let window_url = resolve_frontend_url(ws_url)?;

  WebviewWindowBuilder::new(app, "main", window_url)
    .title(APP_DISPLAY_NAME)
    .inner_size(1100.0, 780.0)
    .min_inner_size(840.0, 620.0)
    .build()
    .map_err(|error| format!("failed to create main window: {error}"))?;

  Ok(())
}

fn stop_backend_process(state: &DesktopRuntimeState) {
  let mut guard = match state.backend_child.lock() {
    Ok(guard) => guard,
    Err(_) => return,
  };

  let Some(child) = guard.as_mut() else {
    return;
  };

  let _ = child.kill();
  let _ = child.wait();
  *guard = None;
}

#[tauri::command]
fn pick_folder() -> Option<String> {
  FileDialog::new()
    .pick_folder()
    .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_documents_path() -> Option<String> {
  dirs::document_dir().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn confirm(message: String) -> bool {
  let result = MessageDialog::new()
    .set_title(APP_DISPLAY_NAME)
    .set_description(&message)
    .set_level(MessageLevel::Info)
    .set_buttons(MessageButtons::OkCancel)
    .show();

  matches!(result, MessageDialogResult::Ok | MessageDialogResult::Yes)
}

#[tauri::command]
fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window is unavailable".to_string())?;

  let selected = match theme.as_str() {
    "light" => Some(Theme::Light),
    "dark" => Some(Theme::Dark),
    "system" => None,
    _ => return Ok(()),
  };

  window
    .set_theme(selected)
    .map_err(|error| format!("failed to set theme: {error}"))
}

#[tauri::command]
fn open_external(url: String) -> bool {
  match Url::parse(&url) {
    Ok(parsed) if parsed.scheme() == "https" || parsed.scheme() == "http" => {
      webbrowser::open(parsed.as_ref()).is_ok()
    }
    _ => false,
  }
}

#[tauri::command]
fn get_ws_url(state: State<'_, DesktopRuntimeState>) -> Option<String> {
  Some(state.ws_url.clone())
}

#[tauri::command]
fn get_update_state(state: State<'_, DesktopRuntimeState>) -> DesktopUpdateState {
  state
    .update_state
    .lock()
    .map(|guard| guard.clone())
    .unwrap_or_else(|_| DesktopUpdateState {
      enabled: false,
      status: "error".to_string(),
      current_version: "unknown".to_string(),
      host_arch: "other".to_string(),
      app_arch: "other".to_string(),
      running_under_arm64_translation: false,
      available_version: None,
      downloaded_version: None,
      download_percent: None,
      checked_at: None,
      message: Some("Failed to read update state.".to_string()),
      error_context: Some("check".to_string()),
      can_retry: false,
    })
}

#[tauri::command]
fn download_update(state: State<'_, DesktopRuntimeState>) -> DesktopUpdateActionResult {
  DesktopUpdateActionResult {
    accepted: false,
    completed: false,
    state: get_update_state(state),
  }
}

#[tauri::command]
fn install_update(state: State<'_, DesktopRuntimeState>) -> DesktopUpdateActionResult {
  DesktopUpdateActionResult {
    accepted: false,
    completed: false,
    state: get_update_state(state),
  }
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let runtime =
        build_runtime_state(&app.handle()).map_err(|error| -> Box<dyn std::error::Error> {
          error.into()
        })?;

      let ws_url = runtime.ws_url.clone();
      app.manage(runtime);
      create_main_window(&app.handle(), &ws_url).map_err(
        |error| -> Box<dyn std::error::Error> { error.into() },
      )?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pick_folder,
      get_documents_path,
      confirm,
      set_theme,
      open_external,
      get_ws_url,
      get_update_state,
      download_update,
      install_update
    ])
    .build(tauri::generate_context!())
    .expect("failed to build Tauri app")
    .run(|app_handle, event| {
      if let RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<DesktopRuntimeState>() {
          stop_backend_process(state.inner());
        }
      }
    });
}
