/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** 项目目录 - Agent Executor 插件根目录（必填） */
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
  "headlessMode": boolean
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

