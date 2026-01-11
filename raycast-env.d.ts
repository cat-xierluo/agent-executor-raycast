/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** 项目目录 - 包含 .claude/commands/ 的项目目录（必填） */
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
  "claudeBin": string
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

