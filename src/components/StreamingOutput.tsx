import { Detail } from "@raycast/api";

export interface StreamingOutputProps {
  output: string;
  isRunning: boolean;
  commandName?: string;
}

/**
 * 流式输出组件 - 使用 Raycast Detail 组件
 * 不使用 DOM API（scrollTop 等），因为 Raycast 环境不支持
 */
export function StreamingOutput({
  output,
  isRunning,
  commandName,
}: StreamingOutputProps) {
  return (
    <Detail
      markdown={
        output
          ? `\`\`\`\n${output}\n\`\`\``
          : isRunning
            ? `_等待${commandName ? ` ${commandName}` : ""}输出..._`
            : "_无输出_"
      }
      navigationTitle={commandName ? `执行: ${commandName}` : "流式输出"}
    />
  );
}
