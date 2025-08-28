#!/bin/bash
echo "正在关闭订餐系统..."

# 通过端口3000查找并结束进程
PID=$(lsof -ti:3000)
if [ ! -z "$PID" ]; then
    echo "找到进程 ID: $PID"
    kill -9 $PID
    echo "订餐系统已关闭"
else
    echo "未找到运行在3000端口的进程"
fi

# 或者通过进程名结束
# pkill -f "node.*server.js"

echo "完成"