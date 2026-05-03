# CLAUDE.md

本文件为 Claude Code/Codex 等 Agents 在此仓库中工作时提供指导。

## 项目概述

SkillDeck 是一个基于 Tauri v2 的桌面应用，为 `npx skills` CLI 工具提供图形界面，支持在全局或项目范围内管理各类 AI Agent（Claude、Codex、Cursor 等）的技能。

## 常用命令

```bash
npm run tauri:dev          # 完整桌面应用 + 热重载（需要 Rust 工具链）
npm run dev                # 仅前端开发服务器（API 调用全部失败）
npm run typecheck          # TypeScript 类型检查
npm run tauri:build        # 生产构建
cargo test --manifest-path src-tauri/Cargo.toml  # Rust 单元测试
```

## 架构

**双层架构：**

- **前端** ([src/](src/))：React 19 + TypeScript + Vite，无 CSS 框架。所有状态集中在 [src/App.tsx](src/App.tsx) 并以 props 向下传递，无 context / store。
- **后端** ([src-tauri/src/main.rs](src-tauri/src/main.rs))：单一 Rust 文件，全部 Tauri 命令在此。每个命令将 `npx skills <子命令>` 作为子进程执行，捕获 stdout/stderr，返回结构化的 `CommandResult`，通过 `tauri::async_runtime::spawn_blocking` 在阻塞线程中运行。

**通信链路：** 视图 → App.tsx 回调 → [src/api/skills.ts](src/api/skills.ts) → `invoke()` → Rust `#[tauri::command]`

**Agent 目录：** Rust 后端通过 `npx --yes --package skills node -e <脚本>` 执行内嵌 Node.js 脚本（`AGENT_CATALOG_SCRIPT` 常量），从已安装的 `skills` 包中提取 Agent 列表及技能目录路径。

## 关键文件

| 文件 | 作用 |
|------|------|
| [src/App.tsx](src/App.tsx) | 全局状态、所有异步回调的发起点 |
| [src/api/skills.ts](src/api/skills.ts) | 唯一的 `invoke()` 调用层 |
| [src/types.ts](src/types.ts) | 前后端共享类型（需与 Rust 结构体手动同步） |
| [src/i18n/locales.ts](src/i18n/locales.ts) | 全部 i18n 翻译文本 |
| [src-tauri/src/main.rs](src-tauri/src/main.rs) | 全部 Tauri 命令与子进程逻辑 |

## 约束

**依赖优先原则（前端 & Tauri）：**
- 前端优先使用已有依赖（`lucide-react`、`@tauri-apps/api` 等），禁止手写等效实现；新增能力时先查现有依赖，再引入成熟开源库。
- Rust 后端优先使用 Tauri 官方插件（`tauri-plugin-dialog`、`tauri-plugin-fs`、`tauri-plugin-shell` 等）；新增系统级功能前先查 [Tauri 插件列表](https://v2.tauri.app/plugin/)。
- 前端界面设计须遵循 `/frontend-design` skill：选定明确美学方向并贯彻执行，注重字体、色彩、动效与空间构成，避免 Inter/Roboto、紫色渐变白底等泛化 AI 风格。

**运行时约束：**
- 单独 `npm run dev` 会导致所有 API 调用失败（无 Tauri 运行时）。
- `canMutate`（App.tsx）仅在 `environment.overall === "ready"` 时为 `true`，控制所有写操作入口。
- 项目范围安装必须提供 `projectPath`，Rust 端执行前校验其为有效目录。
- `run_skills_raw` 白名单：仅允许 `find`、`list`、`add`、`remove`、`update`。
- 命令超时 120 秒（`COMMAND_TIMEOUT` 常量）。

**解耦约束：**
- 视图组件不直接调用 API；所有异步操作由 App.tsx 的回调（`requestInstall`、`requestRemove`、`requestUpdate` 等）统一发起。
- [src/api/skills.ts](src/api/skills.ts) 是唯一与 `invoke()` 交互的层，禁止绕过。
- 前后端通过 [src/types.ts](src/types.ts) 的结构化类型通信，禁止原始字符串拼接或类型断言。
- `t()` 只能以 prop 传递，不得全局导入。

**异步与非阻塞约束：**
- Rust 所有子进程调用必须通过 `spawn_blocking` 包装，禁止在异步命令处理器中直接阻塞。
- 前端所有 API 调用为 Promise，必须 `async/await` 处理。
- 并发数据加载须沿用 `loadInstalled` 的 `requestId` 递增模式防止竞态。
- Rust 子进程 stdout/stderr 采用独立线程读取（`thread::spawn`），避免管道死锁，修改进程逻辑时不得破坏此结构。
