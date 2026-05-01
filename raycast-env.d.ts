/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** 项目目录 - 包含 .claude/skills/ 的项目目录（必填） */
  "projectDir1": string,
  /** 项目目录 2 - 第二个项目目录（可选） */
  "projectDir2"?: string,
  /** 项目目录 3 - 第三个项目目录（可选） */
  "projectDir3"?: string,
  /** 项目目录 4 - 第四个项目目录（可选） */
  "projectDir4"?: string,
  /** 项目目录 5 - 第五个项目目录（可选） */
  "projectDir5"?: string,
  /** Claude CLI 可执行文件路径 - 可选：指定 claude 命令的完整路径（默认：~/.local/bin/claude） */
  "claudeBin": string,
  /** 后台运行模式 - 启用后命令在后台运行（无头模式）。禁用后将弹出终端窗口显示执行过程。 */
  "headlessMode": boolean,
  /** 启用默认 Skills 目录 - 自动扫描 ~/.claude/skills/ 目录中的 Skills */
  "enableDefaultSkills": boolean,
  /** 流式输出模式 - 实时显示 Claude 的输出（类似 SkillLauncher） */
  "streamingMode": boolean,
  /** 最大并发数 - 同时运行的最大 Agent 数量，超出部分排队等待 */
  "concurrencyLimit": "1" | "3" | "5" | "10" | "15"
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `commands` command */
  export type Commands = ExtensionPreferences & {}
  /** Preferences accessible in the `status` command */
  export type Status = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `commands` command */
  export type Commands = {}
  /** Arguments passed to the `status` command */
  export type Status = {}
}

