#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod command_log;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    env, fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const AGENT_CATALOG_SCRIPT: &str = r#"
const fs = require('fs');
const os = require('os');
const path = require('path');

function findSkillsPackageRoot() {
  const names = process.platform === 'win32' ? ['skills.cmd', 'skills.ps1', 'skills'] : ['skills'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      const packageFromBin = findPackageFromBinDir(dir);
      if (packageFromBin) return packageFromBin;
      let real = fs.realpathSync(candidate);
      let current = path.dirname(real);
      while (current && current !== path.dirname(current)) {
        const packageJson = path.join(current, 'package.json');
        if (fs.existsSync(packageJson)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
            if (parsed.name === 'skills') return current;
          } catch {}
        }
        current = path.dirname(current);
      }
    }
  }
  throw new Error('Unable to locate the active official skills package from npx PATH');
}

function findPackageFromBinDir(dir) {
  if (path.basename(dir) !== '.bin') return null;
  const packageJson = path.join(path.dirname(dir), 'skills', 'package.json');
  if (!fs.existsSync(packageJson)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    if (parsed.name === 'skills') return path.dirname(packageJson);
  } catch {}
  return null;
}

function extractBalanced(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Unable to find ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let index = open; index < source.length; index++) {
    const ch = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Unable to parse ${marker}`);
}

function splitTopLevelEntries(block) {
  const entries = [];
  let index = 0;
  while (index < block.length) {
    while (index < block.length && /[\s,]/.test(block[index])) index++;
    if (index >= block.length) break;
    let keyStart = index;
    if (block[index] === '"' || block[index] === "'") {
      const quote = block[index++];
      keyStart = index;
      while (index < block.length && block[index] !== quote) index++;
      var key = block.slice(keyStart, index);
      index++;
    } else {
      while (index < block.length && /[A-Za-z0-9_-]/.test(block[index])) index++;
      var key = block.slice(keyStart, index);
    }
    while (index < block.length && /[\s:]/.test(block[index])) index++;
    if (block[index] !== '{') break;
    const objectStart = index;
    let depth = 0;
    let inString = null;
    let escaped = false;
    for (; index < block.length; index++) {
      const ch = block[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          index++;
          entries.push([key, block.slice(objectStart + 1, index - 1)]);
          break;
        }
      }
    }
  }
  return entries;
}

function stringProp(objectSource, prop) {
  const match = objectSource.match(new RegExp(`\\b${prop}:\\s*"([^"]*)"`));
  return match ? match[1] : '';
}

function rawProp(objectSource, prop) {
  const marker = `${prop}:`;
  const start = objectSource.indexOf(marker);
  if (start < 0) return '';
  let index = start + marker.length;
  while (index < objectSource.length && /\s/.test(objectSource[index])) index++;
  const expressionStart = index;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (; index < objectSource.length; index++) {
    const ch = objectSource[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) break;
  }
  return objectSource.slice(expressionStart, index).trim();
}

function splitArgs(value) {
  const args = [];
  let current = '';
  let inString = null;
  let escaped = false;
  for (const ch of value) {
    if (inString) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const codexHome = (process.env.CODEX_HOME || '').trim() || path.join(home, '.codex');
const claudeHome = (process.env.CLAUDE_CONFIG_DIR || '').trim() || path.join(home, '.claude');
const vibeHome = (process.env.VIBE_HOME || '').trim() || path.join(home, '.vibe');
const vars = { home, configHome, codexHome, claudeHome, vibeHome };

function valueOf(arg) {
  arg = arg.trim();
  if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) return arg.slice(1, -1);
  return vars[arg] || null;
}

function evaluateExpression(expression) {
  expression = expression.trim();
  if (!expression) return null;
  if ((expression.startsWith('"') && expression.endsWith('"')) || (expression.startsWith("'") && expression.endsWith("'"))) return expression.slice(1, -1);
  if (vars[expression]) return vars[expression];
  const joinMatch = expression.match(/^join\((.*)\)$/s);
  if (joinMatch) {
    const parts = splitArgs(joinMatch[1]).map(valueOf);
    if (parts.some((part) => part === null)) return null;
    return path.join(...parts);
  }
  if (expression.startsWith('getOpenClawGlobalSkillsDir')) {
    for (const dir of ['.openclaw', '.clawdbot', '.moltbot']) {
      if (fs.existsSync(path.join(home, dir))) return path.join(home, `${dir}/skills`);
    }
    return path.join(home, '.openclaw/skills');
  }
  return null;
}

function detectionInfo(objectSource) {
  if (objectSource.includes('=> false')) return { status: 'missing', paths: [] };
  const expressions = [];
  const regex = /existsSync\((join\([^)]+\)|"[^"]+"|'[^']+'|[A-Za-z_][A-Za-z0-9_]*)\)/g;
  let match;
  while ((match = regex.exec(objectSource))) expressions.push(match[1]);
  const paths = expressions.map(evaluateExpression).filter(Boolean);
  if (paths.length === 0) return { status: 'unknown', paths: [] };
  return { status: paths.some((candidate) => fs.existsSync(candidate)) ? 'detected' : 'missing', paths };
}

function extractCoreDefaultAgents(source) {
  const match = source.match(/const\s+defaultValues\s*=\s*\[([\s\S]*?)\]\.filter/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

const packageRoot = findSkillsPackageRoot();
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const cliSource = fs.readFileSync(path.join(packageRoot, 'dist', 'cli.mjs'), 'utf8');
const agentsBlock = extractBalanced(cliSource, 'const agents =');
const agents = splitTopLevelEntries(agentsBlock).map(([id, objectSource]) => {
  const projectSkillsDir = stringProp(objectSource, 'skillsDir');
  const hidden = /showInUniversalList:\s*false/.test(objectSource);
  const globalSkillsDir = evaluateExpression(rawProp(objectSource, 'globalSkillsDir'));
  const detection = detectionInfo(objectSource);
  return {
    id,
    displayName: stringProp(objectSource, 'displayName') || id,
    projectSkillsDir,
    globalSkillsDir,
    isUniversal: projectSkillsDir === '.agents/skills' && !hidden,
    hidden,
    detectionStatus: detection.status,
    detectionPaths: detection.paths
  };
});

console.log(JSON.stringify({ agents, packagePath: packageRoot, version: packageJson.version, coreDefaultAgents: extractCoreDefaultAgents(cliSource) }));
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CommandStatus {
    Pending,
    Success,
    Failed,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum EnvironmentOverall {
    Checking,
    Ready,
    Partial,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Scope {
    Global,
    Project,
}

impl Scope {
    fn flag(&self) -> &'static str {
        match self {
            Scope::Global => "-g",
            Scope::Project => "-p",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentCheck {
    name: String,
    ok: bool,
    detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    overall: EnvironmentOverall,
    node: EnvironmentCheck,
    npx: EnvironmentCheck,
    skills: EnvironmentCheck,
    path_preview: Vec<String>,
    version: Option<String>,
    checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandResult {
    id: String,
    status: CommandStatus,
    command: String,
    args: Vec<String>,
    started_at: String,
    finished_at: Option<String>,
    duration_ms: Option<u128>,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandOutputEvent {
    command_id: String,
    stream: &'static str,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckEnvironmentResponse {
    environment: EnvironmentStatus,
    command: CommandResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillSearchResult {
    id: String,
    name: String,
    source: String,
    description: String,
    tags: Vec<String>,
    install_hint: Option<String>,
    raw_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillRecord {
    id: String,
    name: String,
    source: String,
    description: Option<String>,
    agents: Vec<String>,
    scope: Scope,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallRequest {
    source: String,
    skill_names: Vec<String>,
    agents: Vec<String>,
    scope: Scope,
    project_path: Option<String>,
    command_id: Option<String>,
    copy: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillRemoveRequest {
    skill_name: String,
    agents: Vec<String>,
    scope: Scope,
    command_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillUpdateRequest {
    skill_name: String,
    agents: Vec<String>,
    scope: Scope,
    command_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsFindResponse {
    results: Vec<SkillSearchResult>,
    raw_output: String,
    command: CommandResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsListResponse {
    skills: Vec<SkillRecord>,
    raw_output: String,
    parsed: bool,
    command: CommandResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsMutationResponse {
    affected: Vec<SkillRecord>,
    command: CommandResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentInfo {
    id: String,
    display_name: String,
    project_skills_dir: String,
    global_skills_dir: Option<String>,
    is_universal: bool,
    hidden: bool,
    detection_status: String,
    detection_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCatalogResponse {
    agents: Vec<AgentInfo>,
    package_path: Option<String>,
    version: Option<String>,
    core_default_agents: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallDefaultsResponse {
    default_agents: Vec<String>,
    last_selected_agents: Vec<String>,
    detected_agents: Vec<String>,
    needs_agent_selection: bool,
    default_scope: Scope,
    default_copy: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentMetadataResponse {
    catalog: AgentCatalogResponse,
    install_defaults: InstallDefaultsResponse,
}

fn main() {
    tauri::Builder::default()
        .plugin(command_log::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            skills_agent_metadata,
            skills_agent_catalog,
            skills_install_defaults,
            skills_find,
            skills_list,
            skills_add,
            skills_remove,
            skills_update,
            run_skills_raw,
            check_symlink_paths
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SkillDeck");
}

#[tauri::command]
async fn check_environment() -> CheckEnvironmentResponse {
    run_blocking(check_environment_blocking).await
}

#[tauri::command]
async fn skills_agent_catalog() -> AgentCatalogResponse {
    run_blocking(skills_agent_catalog_blocking).await
}

#[tauri::command]
async fn skills_agent_metadata() -> AgentMetadataResponse {
    run_blocking(skills_agent_metadata_blocking).await
}

#[tauri::command]
async fn skills_install_defaults() -> InstallDefaultsResponse {
    run_blocking(skills_install_defaults_blocking).await
}

#[tauri::command]
async fn skills_find(query: String) -> SkillsFindResponse {
    run_blocking(move || skills_find_blocking(query)).await
}

#[tauri::command]
async fn skills_list(
    scope: Scope,
    agents: Vec<String>,
    project_path: Option<String>,
) -> SkillsListResponse {
    run_blocking(move || skills_list_blocking(scope, agents, project_path)).await
}

#[tauri::command]
async fn skills_add(app: AppHandle, request: SkillInstallRequest) -> SkillsMutationResponse {
    run_blocking(move || skills_add_blocking(app, request)).await
}

#[tauri::command]
async fn skills_remove(app: AppHandle, request: SkillRemoveRequest) -> SkillsMutationResponse {
    run_blocking(move || skills_remove_blocking(app, request)).await
}

#[tauri::command]
async fn skills_update(app: AppHandle, request: SkillUpdateRequest) -> SkillsMutationResponse {
    run_blocking(move || skills_update_blocking(app, request)).await
}

#[tauri::command]
async fn run_skills_raw(args: Vec<String>) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_skills_raw_blocking(args))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn check_symlink_paths(paths: Vec<String>) -> Vec<String> {
    run_blocking(move || {
        paths
            .into_iter()
            .filter(|p| {
                fs::symlink_metadata(p.as_str())
                    .map(|metadata| metadata.file_type().is_symlink() && Path::new(p).exists())
                    .unwrap_or(false)
            })
            .collect()
    })
    .await
}

async fn run_blocking<T, F>(task: F) -> T
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .expect("blocking command task failed")
}

fn check_environment_blocking() -> CheckEnvironmentResponse {
    let node = run_command(vec!["--version".to_string()], Some("node"));
    let npx = run_command(vec!["--version".to_string()], Some(npx_binary()));
    let skills = run_command(vec!["skills".to_string(), "--version".to_string()], None);

    let node_check = command_to_check("Node", &node);
    let npx_check = command_to_check("npx", &npx);
    let skills_check = command_to_check("skills CLI", &skills);
    let overall = if !node_check.ok || !npx_check.ok {
        EnvironmentOverall::Missing
    } else if !skills_check.ok {
        EnvironmentOverall::Partial
    } else {
        EnvironmentOverall::Ready
    };
    let version = if skills_check.ok {
        Some(
            first_nonempty_line(&skills.stdout).unwrap_or_else(|| skills.stdout.trim().to_string()),
        )
    } else {
        None
    };

    CheckEnvironmentResponse {
        environment: EnvironmentStatus {
            overall,
            node: node_check,
            npx: npx_check,
            skills: skills_check,
            path_preview: path_candidates(),
            version,
            checked_at: Some(now_iso()),
        },
        command: skills,
    }
}

fn skills_agent_catalog_blocking() -> AgentCatalogResponse {
    let command = run_agent_catalog_command();

    if !matches!(command.status, CommandStatus::Success) {
        return AgentCatalogResponse {
            agents: Vec::new(),
            package_path: None,
            version: None,
            core_default_agents: Vec::new(),
            error: Some(output_text(&command)),
        };
    }

    match serde_json::from_str::<AgentCatalogResponse>(&command.stdout) {
        Ok(response) => response,
        Err(error) => AgentCatalogResponse {
            agents: Vec::new(),
            package_path: None,
            version: None,
            core_default_agents: Vec::new(),
            error: Some(format!(
                "failed to parse official skills agent catalog: {error}"
            )),
        },
    }
}

fn run_agent_catalog_command() -> CommandResult {
    let script_path = env::temp_dir().join(format!("skilldeck-agent-catalog-{}.js", command_id()));
    if let Err(error) = fs::write(&script_path, AGENT_CATALOG_SCRIPT) {
        return failed_command_result(
            vec!["skills".to_string(), "agent-catalog".to_string()],
            format!("failed to write agent catalog script: {error}"),
        );
    }

    let command = run_command(
        build_agent_catalog_args(&script_path),
        None,
    );
    let _ = fs::remove_file(script_path);
    command
}

fn build_agent_catalog_args(script_path: &Path) -> Vec<String> {
    vec![
        "--yes".to_string(),
        "--package".to_string(),
        "skills".to_string(),
        "node".to_string(),
        script_path.to_string_lossy().to_string(),
    ]
}

fn skills_install_defaults_blocking() -> InstallDefaultsResponse {
    let catalog = skills_agent_catalog_blocking();
    install_defaults_from_catalog(&catalog)
}

fn skills_agent_metadata_blocking() -> AgentMetadataResponse {
    let catalog = skills_agent_catalog_blocking();
    let install_defaults = install_defaults_from_catalog(&catalog);
    AgentMetadataResponse {
        catalog,
        install_defaults,
    }
}

fn install_defaults_from_catalog(catalog: &AgentCatalogResponse) -> InstallDefaultsResponse {
    if let Some(error) = catalog.error.clone() {
        return InstallDefaultsResponse {
            default_agents: Vec::new(),
            last_selected_agents: Vec::new(),
            detected_agents: Vec::new(),
            needs_agent_selection: true,
            default_scope: Scope::Project,
            default_copy: false,
            error: Some(error),
        };
    }

    let valid_agents = catalog
        .agents
        .iter()
        .map(|agent| agent.id.clone())
        .collect::<HashSet<_>>();
    let last_selected_agents = read_last_selected_agents()
        .into_iter()
        .filter(|agent| valid_agents.contains(agent))
        .collect::<Vec<_>>();
    let detected_agents = catalog
        .agents
        .iter()
        .filter(|agent| agent.detection_status == "detected")
        .map(|agent| agent.id.clone())
        .collect::<Vec<_>>();
    let default_agents = filter_detected_default_agents(&last_selected_agents, &detected_agents);

    let default_copy = !default_agents.is_empty()
        && unique_project_skill_dirs(&catalog.agents, &default_agents).len() <= 1;

    InstallDefaultsResponse {
        needs_agent_selection: default_agents.is_empty(),
        default_agents,
        last_selected_agents,
        detected_agents,
        default_scope: Scope::Project,
        default_copy,
        error: None,
    }
}

fn unique_project_skill_dirs(agents: &[AgentInfo], selected_agents: &[String]) -> HashSet<String> {
    selected_agents
        .iter()
        .filter_map(|id| agents.iter().find(|agent| agent.id == *id))
        .map(|agent| agent.project_skills_dir.clone())
        .collect()
}

fn filter_detected_default_agents(
    last_selected_agents: &[String],
    detected_agents: &[String],
) -> Vec<String> {
    let detected_agent_ids = detected_agents
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    last_selected_agents
        .iter()
        .filter(|agent| detected_agent_ids.contains(agent.as_str()))
        .cloned()
        .collect()
}

fn skills_find_blocking(query: String) -> SkillsFindResponse {
    let args = vec!["skills".to_string(), "find".to_string(), query.clone()];
    let command = run_command(args, None);
    let raw_output = output_text(&command);
    let results = parse_find_output(&raw_output);

    SkillsFindResponse {
        results,
        raw_output,
        command,
    }
}

fn skills_list_blocking(
    scope: Scope,
    agents: Vec<String>,
    project_path: Option<String>,
) -> SkillsListResponse {
    let mut args = vec![
        "skills".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ];
    args.push(scope.flag().to_string());
    append_agents(&mut args, &agents);

    let project_cwd = match project_cwd_for_list_scope(&scope, project_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return SkillsListResponse {
                skills: Vec::new(),
                raw_output: String::new(),
                parsed: false,
                command: failed_command_result(args, error),
            };
        }
    };

    let command = run_command_with_cwd(args, None, project_cwd.as_deref());
    let raw_output = output_text(&command);
    let skills = parse_list_output(&raw_output, &scope, &agents);
    let parsed = skills.is_some();

    SkillsListResponse {
        skills: skills.unwrap_or_default(),
        raw_output,
        parsed,
        command,
    }
}

fn is_source_segment_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-')
}

fn is_github_shorthand_source(source: &str) -> bool {
    let mut parts = source.trim().split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(repo) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && !owner.is_empty()
        && !repo.is_empty()
        && owner.chars().all(is_source_segment_char)
        && repo.chars().all(is_source_segment_char)
}

fn has_inline_skill_selector(source: &str) -> bool {
    let Some((repo_source, skill_name)) = source.trim().rsplit_once('@') else {
        return false;
    };
    is_github_shorthand_source(repo_source)
        && !skill_name.is_empty()
        && skill_name.chars().all(is_source_segment_char)
}

fn install_source_and_skill_flags(source: &str, skill_names: &[String]) -> (String, Vec<String>) {
    let trimmed_source = source.trim();
    if skill_names.len() == 1 && is_github_shorthand_source(trimmed_source) {
        return (format!("{}@{}", trimmed_source, skill_names[0]), Vec::new());
    }
    if has_inline_skill_selector(trimmed_source) {
        return (trimmed_source.to_string(), Vec::new());
    }
    (trimmed_source.to_string(), skill_names.to_vec())
}

fn build_add_args(request: &SkillInstallRequest) -> Vec<String> {
    let (source, skill_names) =
        install_source_and_skill_flags(&request.source, &request.skill_names);
    let mut args = vec!["skills".to_string(), "add".to_string(), source];
    for skill_name in &skill_names {
        args.push("--skill".to_string());
        args.push(skill_name.clone());
    }
    append_agents(&mut args, &request.agents);
    args.push(request.scope.flag().to_string());
    args.push("-y".to_string());
    if request.copy {
        args.push("--copy".to_string());
    }
    args
}

fn build_remove_args(request: &SkillRemoveRequest) -> Vec<String> {
    let mut args = vec![
        "skills".to_string(),
        "remove".to_string(),
        request.skill_name.clone(),
    ];
    append_agents(&mut args, &request.agents);
    args.push(request.scope.flag().to_string());
    args.push("-y".to_string());
    args
}

fn build_update_args(request: &SkillUpdateRequest) -> Vec<String> {
    let mut args = vec![
        "skills".to_string(),
        "update".to_string(),
        request.skill_name.clone(),
    ];
    append_agents(&mut args, &request.agents);
    args.push(request.scope.flag().to_string());
    args.push("-y".to_string());
    args
}

fn skills_add_blocking(app: AppHandle, request: SkillInstallRequest) -> SkillsMutationResponse {
    let args = build_add_args(&request);
    let project_cwd = match project_cwd_for_scope(
        &request.scope,
        request.project_path.as_deref(),
        "Project install",
    ) {
        Ok(path) => path,
        Err(error) => {
            return SkillsMutationResponse {
                affected: Vec::new(),
                command: failed_command_result(args, error),
            };
        }
    };

    let command = run_command_with_cwd_and_stream(
        args,
        None,
        project_cwd.as_deref(),
        request.command_id.as_deref(),
        Some(&app),
    );
    let affected = request
        .skill_names
        .iter()
        .map(|name| SkillRecord {
            id: format!("{}:{}:{:?}", request.source, name, request.scope),
            name: name.clone(),
            source: request.source.clone(),
            description: None,
            agents: request.agents.clone(),
            scope: request.scope.clone(),
            updated_at: Some(now_iso()),
        })
        .collect();

    SkillsMutationResponse { affected, command }
}

fn project_cwd_for_scope(
    scope: &Scope,
    project_path: Option<&str>,
    operation: &str,
) -> Result<Option<PathBuf>, String> {
    if !matches!(scope, Scope::Project) {
        return Ok(None);
    }

    let project_path = project_path.map(str::trim).unwrap_or_default();
    if project_path.is_empty() {
        return Err(format!("{operation} requires a target project path."));
    }

    let path = PathBuf::from(project_path);
    if !path.is_dir() {
        return Err(format!("Project path is not a directory: {project_path}"));
    }

    Ok(Some(path))
}

fn project_cwd_for_list_scope(
    scope: &Scope,
    project_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if !matches!(scope, Scope::Project) {
        return Ok(None);
    }

    let project_path = project_path.map(str::trim).unwrap_or_default();
    if project_path.is_empty() {
        return env::current_dir()
            .map(Some)
            .map_err(|error| format!("Project list failed to resolve current directory: {error}"));
    }

    let path = PathBuf::from(project_path);
    if !path.is_dir() {
        return Err(format!("Project path is not a directory: {project_path}"));
    }

    Ok(Some(path))
}

fn skills_remove_blocking(app: AppHandle, request: SkillRemoveRequest) -> SkillsMutationResponse {
    let args = build_remove_args(&request);
    let agents = normalize_agents(&request.agents);

    let command = run_command_with_cwd_and_stream(
        args,
        None,
        None,
        request.command_id.as_deref(),
        Some(&app),
    );
    let affected = vec![SkillRecord {
        id: format!("{}:{:?}", request.skill_name, request.scope),
        name: request.skill_name,
        source: String::new(),
        description: None,
        agents,
        scope: request.scope,
        updated_at: None,
    }];

    SkillsMutationResponse { affected, command }
}

fn skills_update_blocking(app: AppHandle, request: SkillUpdateRequest) -> SkillsMutationResponse {
    let args = build_update_args(&request);
    let agents = normalize_agents(&request.agents);

    let command = run_command_with_cwd_and_stream(
        args,
        None,
        None,
        request.command_id.as_deref(),
        Some(&app),
    );
    let affected = vec![SkillRecord {
        id: format!("{}:{:?}", request.skill_name, request.scope),
        name: request.skill_name,
        source: String::new(),
        description: None,
        agents,
        scope: request.scope,
        updated_at: Some(now_iso()),
    }];

    SkillsMutationResponse { affected, command }
}

fn run_skills_raw_blocking(args: Vec<String>) -> Result<CommandResult, String> {
    if args.is_empty() {
        return Err("missing skills subcommand".to_string());
    }

    let allowed: HashSet<&str> = ["find", "list", "add", "remove", "update"]
        .into_iter()
        .collect();
    let first = args.first().map(String::as_str);
    let subcommand = if first == Some("skills") {
        args.get(1).map(String::as_str)
    } else {
        first
    };

    if !subcommand.is_some_and(|value| allowed.contains(value)) {
        return Err("subcommand is not allowed".to_string());
    }

    let final_args = if first == Some("skills") {
        args
    } else {
        let mut prefixed = vec!["skills".to_string()];
        prefixed.extend(args);
        prefixed
    };

    Ok(run_command(final_args, None))
}

fn append_agents(args: &mut Vec<String>, agents: &[String]) {
    for agent in normalize_agents(agents) {
        args.push("--agent".to_string());
        args.push(agent);
    }
}

fn agent_cli_id(agent: &str) -> String {
    let lowercase = agent.trim().to_lowercase();
    lowercase
        .split(|ch: char| ch.is_whitespace() || ch == '_' || ch == '-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn normalize_agents(agents: &[String]) -> Vec<String> {
    agents
        .iter()
        .map(|agent| agent_cli_id(agent))
        .filter(|agent| !agent.is_empty())
        .collect()
}

fn read_last_selected_agents() -> Vec<String> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let lock_path = home.join(".agents").join(".skill-lock.json");
    let Ok(content) = fs::read_to_string(lock_path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };

    value
        .get("lastSelectedAgents")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|agent| !agent.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn home_dir() -> Option<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(key).map(PathBuf::from)
}

fn command_to_check(name: &str, result: &CommandResult) -> EnvironmentCheck {
    let ok = matches!(result.status, CommandStatus::Success);
    let detail = if ok {
        first_nonempty_line(&result.stdout).unwrap_or_else(|| "OK".to_string())
    } else {
        first_nonempty_line(&result.stderr)
            .or_else(|| first_nonempty_line(&result.stdout))
            .or_else(|| result.error.clone())
            .unwrap_or_else(|| "not available".to_string())
    };

    EnvironmentCheck {
        name: name.to_string(),
        ok,
        detail,
    }
}

fn run_command(args: Vec<String>, binary_override: Option<&str>) -> CommandResult {
    run_command_with_cwd(args, binary_override, None)
}

fn run_command_with_cwd(
    args: Vec<String>,
    binary_override: Option<&str>,
    current_dir: Option<&Path>,
) -> CommandResult {
    run_command_with_cwd_and_stream(args, binary_override, current_dir, None, None)
}

fn run_command_with_cwd_and_stream(
    args: Vec<String>,
    binary_override: Option<&str>,
    current_dir: Option<&Path>,
    command_id_override: Option<&str>,
    app: Option<&AppHandle>,
) -> CommandResult {
    let command_name = binary_override.unwrap_or(npx_binary()).to_string();
    let invocation = command_invocation(&command_name);
    let result_id = command_id_override
        .map(str::to_string)
        .unwrap_or_else(command_id);
    let started_at = now_iso();
    let started = Instant::now();
    let mut command = Command::new(&invocation.program);
    command
        .args(&invocation.prefix_args)
        .args(&args)
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let result = CommandResult {
                id: result_id,
                status: CommandStatus::Failed,
                command: invocation.display_command,
                args,
                started_at,
                finished_at: Some(now_iso()),
                duration_ms: Some(started.elapsed().as_millis()),
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                error: Some(error.to_string()),
            };
            command_log::write_command_result(&result, current_dir);
            return result;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stdout_handle = spawn_output_reader(
        stdout,
        Arc::clone(&stdout_buffer),
        app.cloned(),
        result_id.clone(),
        "stdout",
    );
    let stderr_handle = spawn_output_reader(
        stderr,
        Arc::clone(&stderr_buffer),
        app.cloned(),
        result_id.clone(),
        "stderr",
    );

    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() >= COMMAND_TIMEOUT {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait().ok();
                }
                thread::sleep(Duration::from_millis(80));
            }
            Err(_) => break None,
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let stdout = take_buffer(stdout_buffer);
    let stderr = take_buffer(stderr_buffer);
    let exit_code = status.and_then(|value| value.code());
    let command_status = if timed_out {
        CommandStatus::Timeout
    } else if exit_code == Some(0) {
        CommandStatus::Success
    } else {
        CommandStatus::Failed
    };

    let result = CommandResult {
        id: result_id,
        status: command_status,
        command: invocation.display_command,
        args,
        started_at,
        finished_at: Some(now_iso()),
        duration_ms: Some(started.elapsed().as_millis()),
        exit_code,
        stdout,
        stderr,
        error: if timed_out {
            Some("command timed out after 120 seconds".to_string())
        } else {
            None
        },
    };
    command_log::write_command_result(&result, current_dir);
    result
}

fn spawn_output_reader<R>(
    pipe: Option<R>,
    buffer: Arc<Mutex<String>>,
    app: Option<AppHandle>,
    command_id: String,
    stream: &'static str,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Some(pipe) = pipe else {
            return;
        };
        let mut reader = BufReader::new(pipe);
        let mut chunk = String::new();
        loop {
            chunk.clear();
            let Ok(bytes_read) = reader.read_line(&mut chunk) else {
                break;
            };
            if bytes_read == 0 {
                break;
            }
            if let Ok(mut output) = buffer.lock() {
                output.push_str(&chunk);
            }
            if let Some(app) = app.as_ref() {
                let _ = app.emit(
                    "skilldeck://command-output",
                    CommandOutputEvent {
                        command_id: command_id.clone(),
                        stream,
                        chunk: chunk.clone(),
                    },
                );
            }
        }
    })
}

fn take_buffer(buffer: Arc<Mutex<String>>) -> String {
    buffer
        .lock()
        .map(|output| output.clone())
        .unwrap_or_default()
}

fn parse_find_output(output: &str) -> Vec<SkillSearchResult> {
    let mut results = Vec::new();
    let mut pending_url: Option<String> = None;

    for line in output.lines().rev() {
        let cleaned = strip_ansi(line);
        let trimmed = cleaned.trim();

        if trimmed.is_empty() {
            continue;
        }

        if let Some(url) = trimmed.strip_prefix('└').map(str::trim) {
            pending_url = Some(url.to_string());
            continue;
        }

        if trimmed.starts_with("No ")
            || trimmed.starts_with("Install with")
            || trimmed.starts_with("Usage")
            || !trimmed.contains('@')
            || trimmed.contains("://")
        {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(token) = parts.next() else {
            continue;
        };
        let Some((source, name)) = token.rsplit_once('@') else {
            continue;
        };
        let install_count = parts.collect::<Vec<_>>().join(" ");

        results.push(SkillSearchResult {
            id: format!("{}:{}", source, name),
            name: name.to_string(),
            source: source.to_string(),
            description: if install_count.is_empty() {
                trimmed.to_string()
            } else {
                install_count
            },
            tags: Vec::new(),
            install_hint: pending_url.take(),
            raw_line: trimmed.to_string(),
        });
    }

    results.reverse();
    results
}

fn strip_ansi(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }

        cleaned.push(ch);
    }

    cleaned
}

fn parse_list_output(output: &str, scope: &Scope, agents: &[String]) -> Option<Vec<SkillRecord>> {
    let value: Value = serde_json::from_str(output).ok()?;
    let array = value
        .as_array()
        .cloned()
        .or_else(|| value.get("skills").and_then(Value::as_array).cloned())
        .or_else(|| value.get("installed").and_then(Value::as_array).cloned())?;

    let skills = array
        .iter()
        .enumerate()
        .filter_map(|(index, item)| parse_skill_record(item, index, scope, agents))
        .collect();

    Some(skills)
}

fn parse_skill_record(
    item: &Value,
    index: usize,
    scope: &Scope,
    agents: &[String],
) -> Option<SkillRecord> {
    let name = string_field(item, &["name", "skill", "id", "title"])?;
    let source = string_field(item, &["source", "repo", "repository", "package", "path"])
        .unwrap_or_default();
    let description = string_field(item, &["description", "summary"]);
    let updated_at = string_field(
        item,
        &["updatedAt", "updated_at", "modifiedAt", "modified_at"],
    )
    .or_else(|| skill_markdown_modified_iso(&source));
    let parsed_agents = if let Some(items) = item.get("agents").and_then(Value::as_array) {
        let raw_agents = items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        normalize_agents(&raw_agents)
    } else {
        normalize_agents(agents)
    };
    let parsed_scope = string_field(item, &["scope"])
        .and_then(|value| match value.as_str() {
            "global" => Some(Scope::Global),
            "project" => Some(Scope::Project),
            _ => None,
        })
        .unwrap_or_else(|| scope.clone());

    Some(SkillRecord {
        id: string_field(item, &["id"]).unwrap_or_else(|| format!("{}:{}", name, index)),
        name,
        source,
        description,
        agents: parsed_agents,
        scope: parsed_scope,
        updated_at,
    })
}

fn string_field(item: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = item.get(key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn failed_command_result(args: Vec<String>, error: impl Into<String>) -> CommandResult {
    let result = CommandResult {
        id: command_id(),
        status: CommandStatus::Failed,
        command: npx_binary().to_string(),
        args,
        started_at: now_iso(),
        finished_at: Some(now_iso()),
        duration_ms: Some(0),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        error: Some(error.into()),
    };
    command_log::write_command_result(&result, None);
    result
}

fn output_text(result: &CommandResult) -> String {
    if result.stdout.trim().is_empty() {
        result.stderr.clone()
    } else {
        result.stdout.clone()
    }
}

fn first_nonempty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn npx_binary() -> &'static str {
    if cfg!(windows) {
        "npx.cmd"
    } else {
        "npx"
    }
}

struct CommandInvocation {
    program: String,
    prefix_args: Vec<String>,
    display_command: String,
}

fn command_invocation(command_name: &str) -> CommandInvocation {
    if cfg!(windows) && is_npx_command(command_name) {
        if let Some(npx_cli_path) = resolve_npx_cli_path() {
            return CommandInvocation {
                program: "node".to_string(),
                prefix_args: vec![npx_cli_path.to_string_lossy().to_string()],
                display_command: command_name.to_string(),
            };
        }
    }

    CommandInvocation {
        program: command_name.to_string(),
        prefix_args: Vec::new(),
        display_command: command_name.to_string(),
    }
}

fn is_npx_command(command_name: &str) -> bool {
    Path::new(command_name)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("npx") || name.eq_ignore_ascii_case("npx.cmd"))
        .unwrap_or(false)
}

fn resolve_npx_cli_path() -> Option<PathBuf> {
    npx_cli_candidates().into_iter().find(|path| path.is_file())
}

fn npx_cli_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for path in executable_search_paths() {
        candidates.push(path.join("node_modules").join("npm").join("bin").join("npx-cli.js"));
    }
    candidates = dedupe_pathbufs(candidates);
    candidates
}

fn executable_search_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(existing) = env::var_os("PATH") {
        paths.extend(
            env::split_paths(&existing)
                .filter(|path| !path.as_os_str().is_empty())
                .collect::<Vec<_>>(),
        );
    }
    paths.extend(path_candidates().into_iter().map(PathBuf::from));
    dedupe_pathbufs(paths)
}

fn dedupe_pathbufs(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_lowercase()))
        .collect()
}

fn augmented_path() -> String {
    let mut paths = Vec::new();
    if let Some(existing) = env::var_os("PATH") {
        paths.extend(split_path_value(&existing.to_string_lossy()));
    }
    paths.extend(path_candidates());
    paths = dedupe_paths(paths);
    paths.join(if cfg!(windows) { ";" } else { ":" })
}

fn split_path_value(value: &str) -> Vec<String> {
    value
        .split(if cfg!(windows) { ';' } else { ':' })
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect()
}

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn path_candidates() -> Vec<String> {
    let mut paths = Vec::new();

    if cfg!(windows) {
        if let Ok(appdata) = env::var("APPDATA") {
            paths.push(format!("{}\\npm", appdata));
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            paths.push(format!("{}\\nodejs", program_files));
        }
        if let Ok(user_profile) = env::var("USERPROFILE") {
            paths.push(format!("{}\\.volta\\bin", user_profile));
        }
    } else {
        paths.extend(
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
                .into_iter()
                .map(str::to_string),
        );
        if let Ok(home) = env::var("HOME") {
            paths.push(format!("{}/.volta/bin", home));
            paths.push(format!("{}/.fnm", home));
            paths.extend(discover_nvm_bins(&home));
        }
    }

    paths
}

fn discover_nvm_bins(home: &str) -> Vec<String> {
    let versions_dir = PathBuf::from(home).join(".nvm/versions/node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return vec![format!("{}/.nvm/current/bin", home)];
    };

    let mut paths = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let bin = entry.path().join("bin");
            bin.is_dir().then(|| bin.to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths.reverse();
    paths
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn system_time_iso(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn skill_markdown_modified_iso(path: &str) -> Option<String> {
    if path.trim().is_empty() {
        return None;
    }
    fs::metadata(Path::new(path).join("SKILL.md"))
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(system_time_iso)
}

fn command_id() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    format!("cmd-{}-{}", duration.as_secs(), duration.subsec_nanos())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colored_find_output() {
        let output = "\u{1b}[38;5;145manthropics/skills@frontend-design\u{1b}[0m \u{1b}[36m359.5K installs\u{1b}[0m\n\u{1b}[38;5;102m└ https://skills.sh/anthropics/skills/frontend-design\u{1b}[0m\n";

        let results = parse_find_output(output);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "frontend-design");
        assert_eq!(results[0].source, "anthropics/skills");
        assert_eq!(results[0].description, "359.5K installs");
        assert_eq!(
            results[0].install_hint.as_deref(),
            Some("https://skills.sh/anthropics/skills/frontend-design")
        );
    }

    #[test]
    fn parses_list_output_with_path_and_empty_agents() {
        let output = r#"[
  {
    "name": "bb-browser",
    "path": "/Users/linyu/.agents/skills/bb-browser",
    "scope": "global",
    "agents": []
  }
]"#;

        let skills = parse_list_output(output, &Scope::Global, &["codex".to_string()]).unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "bb-browser");
        assert_eq!(skills[0].source, "/Users/linyu/.agents/skills/bb-browser");
        assert!(skills[0].agents.is_empty());
    }

    #[test]
    fn preserves_existing_path_priority() {
        let paths = dedupe_paths(vec![
            "/Users/linyu/.nvm/versions/node/v24.14.1/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/local/bin".to_string(),
        ]);

        assert_eq!(paths[0], "/Users/linyu/.nvm/versions/node/v24.14.1/bin");
        assert_eq!(paths[1], "/usr/local/bin");
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn detects_npx_command_names() {
        assert!(is_npx_command("npx"));
        assert!(is_npx_command("npx.cmd"));
        assert!(is_npx_command("C:\\Program Files\\nodejs\\npx.cmd"));
        assert!(!is_npx_command("node"));
    }

    #[test]
    fn agent_catalog_script_resolves_npx_bin_package_root() {
        let dir = env::temp_dir().join(format!("skilldeck-npx-bin-test-{}", command_id()));
        let bin_dir = dir.join("node_modules").join(".bin");
        let package_dir = dir.join("node_modules").join("skills");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&package_dir).unwrap();
        fs::write(bin_dir.join("skills.cmd"), "").unwrap();
        fs::write(package_dir.join("package.json"), r#"{"name":"skills"}"#).unwrap();

        let previous_path = env::var_os("PATH");
        let node = resolve_node_for_test(&previous_path).unwrap_or_else(|| "node".to_string());
        env::set_var("PATH", bin_dir.as_os_str());
        let command = run_command(
            vec![
                "-e".to_string(),
                format!(
                    "const fs = require('fs'); const path = require('path'); {}\n{}\nconsole.log(findSkillsPackageRoot())",
                    extract_js_function(AGENT_CATALOG_SCRIPT, "findPackageFromBinDir"),
                    extract_js_function(AGENT_CATALOG_SCRIPT, "findSkillsPackageRoot"),
                ),
            ],
            Some(&node),
        );
        if let Some(previous_path) = previous_path {
            env::set_var("PATH", previous_path);
        }

        assert!(matches!(command.status, CommandStatus::Success));
        assert_eq!(normalize_path_for_test(command.stdout.trim()), normalize_path_for_test(&package_dir.to_string_lossy()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agent_catalog_command_uses_script_file_not_eval() {
        let script_path = env::temp_dir().join("skilldeck-agent-catalog-test.js");
        let args = build_agent_catalog_args(&script_path);

        assert_eq!(args[0..4], ["--yes", "--package", "skills", "node"]);
        assert_eq!(args[4], script_path.to_string_lossy());
        assert!(!args.iter().any(|arg| arg == "-e"));
        assert!(!args.iter().any(|arg| arg.contains("findSkillsPackageRoot")));
    }

    fn normalize_path_for_test(path: &str) -> String {
        path.replace('\\', "/")
    }

    fn resolve_node_for_test(path: &Option<std::ffi::OsString>) -> Option<String> {
        let path = path.as_ref()?;
        for dir in env::split_paths(path) {
            let candidate = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }

    fn extract_js_function(source: &str, name: &str) -> String {
        let marker = format!("function {name}");
        let start = source.find(&marker).unwrap();
        let open = source[start..].find('{').map(|index| start + index).unwrap();
        let mut depth = 0;
        for (offset, ch) in source[open..].char_indices() {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    return source[start..=open + offset].to_string();
                }
            }
        }
        panic!("missing function body for {name}");
    }

    #[test]
    fn default_agents_must_be_detected() {
        let last_selected_agents = vec![
            "codex".to_string(),
            "cursor".to_string(),
            "missing-agent".to_string(),
        ];
        let detected_agents = vec!["cursor".to_string()];

        let default_agents =
            filter_detected_default_agents(&last_selected_agents, &detected_agents);

        assert_eq!(default_agents, vec!["cursor".to_string()]);
    }

    // ── strip_ansi ───────────────────────────────────────────────────────────

    #[test]
    fn strip_ansi_plain_text_unchanged() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }

    #[test]
    fn strip_ansi_removes_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[32mgreen\u{1b}[0m"), "green");
    }

    #[test]
    fn strip_ansi_removes_256_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[38;5;145mtext\u{1b}[0m"), "text");
    }

    #[test]
    fn strip_ansi_empty_string() {
        assert_eq!(strip_ansi(""), "");
    }

    // ── string_field ─────────────────────────────────────────────────────────

    #[test]
    fn string_field_returns_first_matching_key() {
        let v: serde_json::Value = serde_json::json!({ "name": "my-skill" });
        assert_eq!(
            string_field(&v, &["name", "title"]).as_deref(),
            Some("my-skill")
        );
    }

    #[test]
    fn string_field_falls_back_to_second_key() {
        let v: serde_json::Value = serde_json::json!({ "title": "fallback" });
        assert_eq!(
            string_field(&v, &["name", "title"]).as_deref(),
            Some("fallback")
        );
    }

    #[test]
    fn string_field_ignores_whitespace_only_values() {
        let v: serde_json::Value = serde_json::json!({ "name": "   ", "title": "real" });
        assert_eq!(
            string_field(&v, &["name", "title"]).as_deref(),
            Some("real")
        );
    }

    #[test]
    fn string_field_returns_none_when_missing() {
        let v: serde_json::Value = serde_json::json!({});
        assert!(string_field(&v, &["name"]).is_none());
    }

    // ── parse_list_output ────────────────────────────────────────────────────

    #[test]
    fn parse_list_output_skills_wrapper() {
        let output = r#"{ "skills": [{ "name": "x", "source": "/path/x", "scope": "global" }] }"#;
        let skills = parse_list_output(output, &Scope::Global, &[]).unwrap();
        assert_eq!(skills[0].name, "x");
    }

    #[test]
    fn parse_list_output_installed_wrapper() {
        let output = r#"{ "installed": [{ "name": "y", "source": "/path/y" }] }"#;
        let skills = parse_list_output(output, &Scope::Project, &[]).unwrap();
        assert_eq!(skills[0].name, "y");
        assert!(matches!(skills[0].scope, Scope::Project));
    }

    #[test]
    fn parse_list_output_returns_none_on_invalid_json() {
        assert!(parse_list_output("not json", &Scope::Global, &[]).is_none());
    }

    #[test]
    fn parse_list_output_returns_none_on_missing_array() {
        assert!(parse_list_output(r#"{"other":1}"#, &Scope::Global, &[]).is_none());
    }

    #[test]
    fn parse_list_output_agents_fall_back_to_request_agents() {
        let output = r#"[{ "name": "z", "source": "/p/z" }]"#;
        let agents = vec!["claude-code".to_string()];
        let skills = parse_list_output(output, &Scope::Global, &agents).unwrap();
        assert_eq!(skills[0].agents, agents);
    }

    #[test]
    fn parse_list_output_normalizes_display_agent_names() {
        let output =
            r#"[{ "name": "z", "source": "/p/z", "agents": ["Claude Code", "OpenClaw"] }]"#;
        let skills = parse_list_output(output, &Scope::Global, &[]).unwrap();
        assert_eq!(
            skills[0].agents,
            vec!["claude-code".to_string(), "openclaw".to_string()]
        );
    }

    #[test]
    fn parse_list_output_scope_from_json_overrides_request_scope() {
        let output = r#"[{ "name": "z", "source": "/p/z", "scope": "project" }]"#;
        let skills = parse_list_output(output, &Scope::Global, &[]).unwrap();
        assert!(matches!(skills[0].scope, Scope::Project));
    }

    #[test]
    fn parse_project_list_output_from_official_cli() {
        let output = r#"[{
            "name": "frontend-design",
            "path": "D:\\Develop\\CodeProjects\\skilldeck\\.agents\\skills\\frontend-design",
            "scope": "project",
            "agents": ["Codex", "Gemini CLI", "GitHub Copilot", "OpenCode"]
        }]"#;

        let skills = parse_list_output(output, &Scope::Project, &[]).unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "frontend-design");
        assert_eq!(
            skills[0].source,
            "D:\\Develop\\CodeProjects\\skilldeck\\.agents\\skills\\frontend-design"
        );
        assert!(matches!(skills[0].scope, Scope::Project));
        assert_eq!(
            skills[0].agents,
            vec![
                "codex".to_string(),
                "gemini-cli".to_string(),
                "github-copilot".to_string(),
                "opencode".to_string()
            ]
        );
    }

    #[test]
    fn parse_list_output_accepts_alternate_name_keys() {
        for key in ["skill", "id", "title"] {
            let output = format!(r#"[{{ "{key}": "alt-name" }}]"#);
            let skills = parse_list_output(&output, &Scope::Global, &[]).unwrap();
            assert_eq!(skills[0].name, "alt-name", "failed for key '{key}'");
        }
    }

    #[test]
    fn parse_list_output_preserves_cli_updated_at() {
        let output = r#"[{
            "name": "dated",
            "path": "/path/that/does/not/exist",
            "updatedAt": "2026-05-04T10:20:30.000Z"
        }]"#;
        let skills = parse_list_output(output, &Scope::Global, &[]).unwrap();
        assert_eq!(
            skills[0].updated_at.as_deref(),
            Some("2026-05-04T10:20:30.000Z")
        );
    }

    #[test]
    fn parse_list_output_falls_back_to_skill_markdown_modified_time() {
        let dir = env::temp_dir().join(format!("skilldeck-mtime-test-{}", command_id()));
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "# local\n").unwrap();
        let output = serde_json::json!([{ "name": "local", "path": dir }]).to_string();

        let skills = parse_list_output(&output, &Scope::Global, &[]).unwrap();

        assert!(skills[0].updated_at.is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parse_list_output_does_not_fall_back_without_skill_markdown() {
        let dir = env::temp_dir().join(format!("skilldeck-no-skill-md-test-{}", command_id()));
        fs::create_dir(&dir).unwrap();
        let output = serde_json::json!([{ "name": "local", "path": dir }]).to_string();

        let skills = parse_list_output(&output, &Scope::Global, &[]).unwrap();

        assert!(skills[0].updated_at.is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    // ── parse_find_output ────────────────────────────────────────────────────

    #[test]
    fn parse_find_output_multiple_results() {
        let output = "anthropics/skills@code-review 10 installs\nanthropics/skills@documentation-writer 5 installs\n";
        let results = parse_find_output(output);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "code-review");
        assert_eq!(results[1].name, "documentation-writer");
    }

    #[test]
    fn parse_find_output_no_url_hint_when_missing() {
        let output = "anthropics/skills@code-review 10 installs\n";
        let results = parse_find_output(output);
        assert_eq!(results.len(), 1);
        assert!(results[0].install_hint.is_none());
    }

    #[test]
    fn parse_find_output_skips_non_skill_lines() {
        let output = "No skills found\nUsage: skills find <query>\n";
        assert!(parse_find_output(output).is_empty());
    }

    #[test]
    fn parse_find_output_skips_lines_with_url_scheme() {
        let output = "https://skills.sh/anthropics/skills\n";
        assert!(parse_find_output(output).is_empty());
    }

    // ── split_path_value ─────────────────────────────────────────────────────

    #[test]
    fn split_path_value_colon_separated() {
        if cfg!(windows) {
            return;
        }

        let result = split_path_value("/usr/bin:/usr/local/bin:/opt/bin");
        assert_eq!(result, vec!["/usr/bin", "/usr/local/bin", "/opt/bin"]);
    }

    #[test]
    fn split_path_value_filters_empty_segments() {
        if cfg!(windows) {
            return;
        }

        let result = split_path_value("/usr/bin::/usr/local/bin");
        assert_eq!(result, vec!["/usr/bin", "/usr/local/bin"]);
    }

    #[test]
    fn split_path_value_trims_whitespace() {
        if cfg!(windows) {
            return;
        }

        let result = split_path_value(" /usr/bin : /usr/local/bin ");
        assert_eq!(result, vec!["/usr/bin", "/usr/local/bin"]);
    }

    // ── append_agents ────────────────────────────────────────────────────────

    #[test]
    fn agent_cli_id_normalizes_display_names() {
        assert_eq!(agent_cli_id("Claude Code"), "claude-code");
        assert_eq!(agent_cli_id("GitHub Copilot"), "github-copilot");
        assert_eq!(agent_cli_id("  CodeArts   Agent  "), "codearts-agent");
        assert_eq!(agent_cli_id("qwen_code"), "qwen-code");
    }

    #[test]
    fn append_agents_normalizes_names() {
        let mut args: Vec<String> = vec!["skills".to_string(), "remove".to_string()];
        append_agents(
            &mut args,
            &["OpenClaw".to_string(), "Claude Code".to_string()],
        );
        assert_eq!(args[2], "--agent");
        assert_eq!(args[3], "openclaw");
        assert_eq!(args[4], "--agent");
        assert_eq!(args[5], "claude-code");
    }

    #[test]
    fn append_agents_no_args_when_empty() {
        let mut args: Vec<String> = vec!["skills".to_string()];
        append_agents(&mut args, &[]);
        assert_eq!(args.len(), 1);
    }

    #[test]
    fn append_agents_skips_blank_names() {
        let mut args: Vec<String> = vec!["skills".to_string()];
        append_agents(&mut args, &["  ".to_string()]);
        assert_eq!(args.len(), 1);
    }

    // ── project_cwd_for_scope ────────────────────────────────────────────────

    #[test]
    fn project_cwd_for_scope_global_returns_none() {
        let result = project_cwd_for_scope(&Scope::Global, Some("/any/path"), "op");
        assert!(matches!(result, Ok(None)));
    }

    #[test]
    fn project_cwd_for_scope_project_empty_path_errors() {
        let result = project_cwd_for_scope(&Scope::Project, Some("  "), "Test op");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Test op"));
    }

    #[test]
    fn project_cwd_for_scope_project_none_path_errors() {
        let result = project_cwd_for_scope(&Scope::Project, None, "Test op");
        assert!(result.is_err());
    }

    #[test]
    fn project_cwd_for_list_scope_project_none_uses_current_dir() {
        let result = project_cwd_for_list_scope(&Scope::Project, None).unwrap();
        assert_eq!(result, Some(env::current_dir().unwrap()));
    }

    #[test]
    fn project_cwd_for_list_scope_project_empty_uses_current_dir() {
        let result = project_cwd_for_list_scope(&Scope::Project, Some("  ")).unwrap();
        assert_eq!(result, Some(env::current_dir().unwrap()));
    }

    #[test]
    fn project_cwd_for_list_scope_global_returns_none() {
        let result = project_cwd_for_list_scope(&Scope::Global, None);
        assert!(matches!(result, Ok(None)));
    }

    #[test]
    fn project_cwd_for_scope_project_valid_dir_returns_path() {
        let dir = std::env::temp_dir();
        let result = project_cwd_for_scope(&Scope::Project, dir.to_str(), "op");
        assert!(matches!(result, Ok(Some(_))));
    }

    #[test]
    fn project_cwd_for_scope_project_nonexistent_dir_errors() {
        let result = project_cwd_for_scope(
            &Scope::Project,
            Some("/nonexistent/skilldeck-test-path"),
            "op",
        );
        assert!(result.is_err());
    }

    // ── first_nonempty_line ──────────────────────────────────────────────────

    #[test]
    fn first_nonempty_line_skips_blanks() {
        assert_eq!(
            first_nonempty_line("\n\n  hello\nworld"),
            Some("hello".to_string())
        );
    }

    #[test]
    fn first_nonempty_line_returns_none_for_blank_input() {
        assert!(first_nonempty_line("   \n\n").is_none());
    }

    // ── build_add_args ───────────────────────────────────────────────────────

    #[test]
    fn build_add_args_global_scope() {
        let req = SkillInstallRequest {
            source: "anthropics/skills".to_string(),
            skill_names: vec!["code-review".to_string()],
            agents: vec!["claude-code".to_string()],
            scope: Scope::Global,
            project_path: None,
            command_id: None,
            copy: false,
        };
        let args = build_add_args(&req);
        assert_eq!(
            &args[..3],
            &["skills", "add", "anthropics/skills@code-review"]
        );
        assert!(!args.contains(&"--skill".to_string()));
        assert!(args.contains(&"--agent".to_string()));
        assert!(args.contains(&"claude-code".to_string()));
        assert!(args.contains(&"-g".to_string()));
        assert!(args.contains(&"-y".to_string()));
        assert!(!args.contains(&"--copy".to_string()));
    }

    #[test]
    fn build_add_args_keeps_skill_flag_for_url_sources() {
        let req = SkillInstallRequest {
            source: "https://github.com/heygen-com/hyperframes".to_string(),
            skill_names: vec!["hyperframes".to_string()],
            agents: vec![],
            scope: Scope::Global,
            project_path: None,
            command_id: None,
            copy: false,
        };
        let args = build_add_args(&req);
        assert_eq!(args[2], "https://github.com/heygen-com/hyperframes");
        assert!(args.contains(&"--skill".to_string()));
        assert!(args.contains(&"hyperframes".to_string()));
    }

    #[test]
    fn build_add_args_does_not_duplicate_inline_skill_selector() {
        let req = SkillInstallRequest {
            source: "heygen-com/hyperframes@hyperframes".to_string(),
            skill_names: vec!["hyperframes".to_string()],
            agents: vec![],
            scope: Scope::Global,
            project_path: None,
            command_id: None,
            copy: false,
        };
        let args = build_add_args(&req);
        assert_eq!(args[2], "heygen-com/hyperframes@hyperframes");
        assert!(!args.contains(&"--skill".to_string()));
    }

    #[test]
    fn build_add_args_project_scope_with_copy() {
        let req = SkillInstallRequest {
            source: "repo".to_string(),
            skill_names: vec!["x".to_string()],
            agents: vec![],
            scope: Scope::Project,
            project_path: None,
            command_id: None,
            copy: true,
        };
        let args = build_add_args(&req);
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"--copy".to_string()));
    }

    #[test]
    fn build_add_args_normalizes_agents() {
        let req = SkillInstallRequest {
            source: "repo".to_string(),
            skill_names: vec!["x".to_string()],
            agents: vec!["Claude Code".to_string()],
            scope: Scope::Global,
            project_path: None,
            command_id: None,
            copy: false,
        };
        let args = build_add_args(&req);
        let idx = args.iter().position(|a| a == "--agent").unwrap();
        assert_eq!(args[idx + 1], "claude-code");
    }

    // ── build_remove_args ────────────────────────────────────────────────────

    #[test]
    fn build_remove_args_structure() {
        let req = SkillRemoveRequest {
            skill_name: "documentation-writer".to_string(),
            agents: vec![],
            scope: Scope::Global,
            command_id: None,
        };
        let args = build_remove_args(&req);
        assert_eq!(&args[..3], &["skills", "remove", "documentation-writer"]);
        assert!(args.contains(&"-g".to_string()));
        assert!(args.contains(&"-y".to_string()));
    }

    #[test]
    fn build_remove_args_normalizes_agents() {
        let req = SkillRemoveRequest {
            skill_name: "x".to_string(),
            agents: vec!["Claude Code".to_string()],
            scope: Scope::Global,
            command_id: None,
        };
        let args = build_remove_args(&req);
        let idx = args.iter().position(|a| a == "--agent").unwrap();
        assert_eq!(args[idx + 1], "claude-code");
    }

    #[test]
    fn build_remove_args_project_scope() {
        let req = SkillRemoveRequest {
            skill_name: "x".to_string(),
            agents: vec![],
            scope: Scope::Project,
            command_id: None,
        };
        let args = build_remove_args(&req);
        assert!(args.contains(&"-p".to_string()));
        assert!(!args.contains(&"-g".to_string()));
    }

    // ── build_update_args ────────────────────────────────────────────────────

    #[test]
    fn build_update_args_structure() {
        let req = SkillUpdateRequest {
            skill_name: "my-skill".to_string(),
            agents: vec!["cursor".to_string()],
            scope: Scope::Global,
            command_id: None,
        };
        let args = build_update_args(&req);
        assert_eq!(&args[..3], &["skills", "update", "my-skill"]);
        assert!(args.contains(&"--agent".to_string()));
        assert!(args.contains(&"cursor".to_string()));
        assert!(args.contains(&"-g".to_string()));
        assert!(args.contains(&"-y".to_string()));
    }

    #[test]
    fn build_update_args_normalizes_agents() {
        let req = SkillUpdateRequest {
            skill_name: "x".to_string(),
            agents: vec!["GitHub Copilot".to_string()],
            scope: Scope::Global,
            command_id: None,
        };
        let args = build_update_args(&req);
        let idx = args.iter().position(|a| a == "--agent").unwrap();
        assert_eq!(args[idx + 1], "github-copilot");
    }
}
