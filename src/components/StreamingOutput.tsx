import { useState, useEffect, useRef } from "react";
import { Detail, Color } from "@raycast/api";

export interface StreamingOutputProps {
  output: string;
  isRunning: boolean;
  commandName?: string;
}

export function StreamingOutput({ output, isRunning, commandName }: StreamingOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <Detail
      markdown={
        output
          ? `\`\`\`\n${output}\n\`\`\``
          : isRunning
          ? `_等待${commandName ? `${commandName} ` : ""}输出..._`
          : "_无输出_"
      }
      navigationTitle={commandName ? `执行: ${commandName}` : "流式输出"}
      metadata={
        isRunning
          ? {
              items: [
                {
                  label: "状态",
                  value: "🔄 执行中...",
                  color: Color.Blue,
                },
              ],
            }
          : {
              items: [
                {
                  label: "状态",
                  value: "✅ 完成",
                  color: Color.Green,
                },
              ],
            }
      }
    />
  );
}

// 简单的文本区域版本（用于内联显示）
export function StreamingTextArea({
  output,
  isRunning,
  onClear,
}: {
  output: string;
  isRunning: boolean;
  onClear?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && isRunning) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, isRunning]);

  return (
    <div
      style={{
        backgroundColor: "#1e1e1e",
        color: "#d4d4d4",
        fontFamily: "monospace",
        fontSize: "12px",
        padding: "12px",
        borderRadius: "8px",
        maxHeight: "300px",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
      ref={scrollRef}
    >
      <div style={{ marginBottom: "8px", color: "#888" }}>
        {isRunning ? "🔄 执行中..." : "✅ 完成"}
      </div>
      {output || "等待输出..."}
      {onClear && output && !isRunning && (
        <button
          onClick={onClear}
          style={{
            marginTop: "12px",
            padding: "4px 12px",
            backgroundColor: "#333",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          清空
        </button>
      )}
    </div>
  );
}
