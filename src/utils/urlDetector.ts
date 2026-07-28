/**
 * URL / 路径输入解析工具
 *
 * 用于在搜索栏自动识别 URL 输入：
 * - 当搜索栏以 http:// https:// file:// x-devonthink-item:// 开头时，
 *   提取 URL 并把剩余文本作为备注。
 * - 其他类型输入（普通文本、本地路径）保持原样。
 *
 * 设计原则：
 * - URL 必须以 scheme 开头，避免误判本地路径或纯文本。
 * - URL 内部不允许空格，避免吞掉后续备注。
 * - 第一个 URL 之后的所有内容都视为 note。
 */

// URL 前缀识别：scheme 必须以字母开头，scheme 之后必须是 ://
const URL_PATTERN =
  /^((https?|x-devonthink-item|file):\/\/[^\s]+)\s*([\s\S]*)$/i;

export interface ParsedNoteInput {
  /** 提取出的 URL（含 scheme），无 URL 时为空字符串 */
  url: string;
  /** URL 之外剩余的备注文本 */
  note: string;
}

/**
 * 解析搜索栏输入，拆分为 URL 与剩余备注。
 *
 * @example
 * parseNoteInput("https://example.com/x.pdf")
 * // => { url: "https://example.com/x.pdf", note: "" }
 *
 * parseNoteInput("https://example.com/x.pdf 帮我总结")
 * // => { url: "https://example.com/x.pdf", note: "帮我总结" }
 *
 * parseNoteInput("x-devonthink-item://12345 提取摘要")
 * // => { url: "x-devonthink-item://12345", note: "提取摘要" }
 *
 * parseNoteInput("请总结这个 PDF")
 * // => { url: "", note: "请总结这个 PDF" }
 */
export function parseNoteInput(note: string): ParsedNoteInput {
  const trimmed = note.trim();
  if (!trimmed) return { url: "", note: "" };
  const match = trimmed.match(URL_PATTERN);
  if (!match) return { url: "", note: trimmed };
  return {
    url: match[1],
    note: (match[3] || "").trim(),
  };
}

/**
 * 判断字符串是否以 URL scheme 开头。
 *
 * 留扩展点：未来可加入本地路径或 ~ 路径识别，调用方应优先用 parseNoteInput。
 */
export function isUrlOrPath(input: string): boolean {
  if (!input) return false;
  return /^([a-z][a-z0-9+\-.]*):\/\//i.test(input.trim());
}
