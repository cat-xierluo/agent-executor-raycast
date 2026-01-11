# AutoWeave Raycast 扩展 - 日志说明

## 日志位置

运行日志保存在：`logs/` 目录

```
logs/
├── index.txt          # 运行索引（显示所有运行的概览）
├── runs/              # 详细日志目录
│   └── run_*.log     # 每次运行的详细日志
└── errors.log        # 错误日志
```

## 查看日志

### 方法一：使用脚本（推荐）

在终端中运行：

```bash
# 显示运行索引
./logs/view-logs.sh

# 显示最后一次运行日志
./logs/view-logs.sh --last

# 显示帮助
./logs/view-logs.sh --help
```

### 方法二：直接查看文件

- **运行索引**：`logs/index.txt`
- **详细日志**：`logs/runs/run_YYYYMMDD_HHMMSS_PID.log`
- **错误日志**：`logs/errors.log`

## 日志格式

### 索引文件格式
```
[2026/1/10 17:31:59] [SUCCESS] run_20260110_173126_4093 - 文件名.pdf (33s)
  → logs/runs/run_20260110_173126_4093.log
```

### 详细日志格式
```
========================================
AutoWeave Raycast Extension - 运行日志
========================================
Run ID: run_20260110_173126_4093
开始时间: 2026-01-10T17:31:26.123Z
目标路径: /path/to/file.pdf
工作目录: /path/to
命令: /legal-router
----------------------------------------

执行输出:
========================================
[Claude 的输出内容]
========================================

结束时间: 2026-01-10T17:31:59.456Z
执行时长: 33秒
退出码: 0
```

## 故障排除

### 如果没有日志

1. 确认已成功执行命令
2. 检查 `logs/` 目录是否存在
3. 如果目录不存在，手动创建：
   ```bash
   mkdir -p logs/runs
   ```

### 如果运行失败

1. 查看 `logs/errors.log` 获取错误信息
2. 使用 `./logs/view-logs.sh --last` 查看最后一次运行的详细日志
3. 检查运行索引文件 `logs/index.txt`

### 如果权限问题

确保对 `logs/` 目录有写入权限：
```bash
chmod 755 logs/
chmod 755 logs/runs/
```
