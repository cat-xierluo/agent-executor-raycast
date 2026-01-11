import { useEffect, useState } from "react";

// 状态刷新事件系统
type StatusRefreshListener = () => void;

class StatusRefreshManager {
  private listeners: Set<StatusRefreshListener> = new Set();
  private version = 0;

  subscribe(listener: StatusRefreshListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh() {
    this.version += 1;
    console.log('[StatusRefreshManager] Refreshing status, version:', this.version);
    this.listeners.forEach(listener => listener());
  }

  getVersion() {
    return this.version;
  }
}

// 全局实例
const statusRefreshManager = new StatusRefreshManager();

// 导出供其他模块使用的函数
export function triggerStatusRefresh() {
  statusRefreshManager.refresh();
}

// React Hook供组件使用
export function useStatusRefresh() {
  const [version, setVersion] = useState(statusRefreshManager.getVersion());

  useEffect(() => {
    const unsubscribe = statusRefreshManager.subscribe(() => {
      setVersion(statusRefreshManager.getVersion());
    });
    return unsubscribe;
  }, []);

  return { refreshStatus: () => triggerStatusRefresh(), version };
}
