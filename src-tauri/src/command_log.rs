use crate::CommandResult;
use serde::Serialize;
use std::{env, path::Path};
use tauri::{plugin::TauriPlugin, Runtime};
use tauri_plugin_log::{Target, TargetKind};

const COMMAND_LOG_TARGET: &str = "skilldeck::command";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandLogEntry<'a> {
    logged_at: String,
    cwd: Option<String>,
    command: &'a CommandResult,
}

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .clear_format()
        .level(log::LevelFilter::Info)
        .target(
            Target::new(TargetKind::LogDir {
                file_name: Some("commands".into()),
            })
            .filter(|metadata| metadata.target() == COMMAND_LOG_TARGET),
        )
        .build()
}

pub(crate) fn write_command_result(result: &CommandResult, current_dir: Option<&Path>) {
    let entry = CommandLogEntry {
        logged_at: now_iso(),
        cwd: command_cwd(current_dir),
        command: result,
    };

    if let Ok(payload) = serde_json::to_string(&entry) {
        log::info!(target: COMMAND_LOG_TARGET, "{payload}");
    }
}

fn command_cwd(current_dir: Option<&Path>) -> Option<String> {
    current_dir
        .map(|path| path.to_path_buf())
        .or_else(|| env::current_dir().ok())
        .map(|path| path.to_string_lossy().to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
