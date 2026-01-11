#!/bin/bash
# AutoWeave Raycast 扩展 - 日志查看工具
# 使用方法：./view-logs.sh [选项]

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 检查日志目录是否存在
LOG_DIR="$(dirname "$0")"
if [ ! -d "$LOG_DIR" ]; then
    echo -e "${RED}错误: 日志目录不存在${NC}"
    exit 1
fi

RUNS_DIR="$LOG_DIR/runs"
INDEX_FILE="$LOG_DIR/index.txt"

# 显示帮助
show_help() {
    echo -e "${BOLD}AutoWeave Raycast 扩展 - 日志查看工具${NC}"
    echo ""
    echo "使用方法:"
    echo "  $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --index     显示运行索引（默认）"
    echo "  --last      显示最后一次运行日志"
    echo "  --help      显示此帮助信息"
    echo ""
}

# 显示运行索引
show_index() {
    if [ ! -f "$INDEX_FILE" ]; then
        echo -e "${YELLOW}暂无运行记录${NC}"
        return
    fi

    echo -e "${BOLD}📋 运行索引（最新在前）${NC}"
    echo "=================================="
    cat "$INDEX_FILE" | grep -v "^#" | head -20
    echo ""
}

# 显示最后一次运行
show_last() {
    if [ ! -f "$INDEX_FILE" ]; then
        echo -e "${YELLOW}暂无运行记录${NC}"
        return
    fi

    # 从索引获取最后一次运行
    LAST_RUN=$(grep -E "^\[.*\] \[(SUCCESS|FAILED)\]" "$INDEX_FILE" | head -1)
    if [ -z "$LAST_RUN" ]; then
        echo -e "${YELLOW}暂无运行记录${NC}"
        return
    fi

    # 提取 run_id
    RUN_ID=$(echo "$LAST_RUN" | grep -oE 'run_[0-9]{8}_[0-9]{6}_[0-9]+')
    LOG_FILE="$RUNS_DIR/${RUN_ID}.log"

    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${RED}日志文件不存在: $LOG_FILE${NC}"
        return
    fi

    echo -e "${BOLD}📄 最后一次运行日志${NC}"
    echo "=================================="
    cat "$LOG_FILE"
    echo ""
}

# 主逻辑
case "${1:-}" in
    --help|-h)
        show_help
        ;;
    --last|-l)
        show_last
        ;;
    *)
        show_index
        ;;
esac
