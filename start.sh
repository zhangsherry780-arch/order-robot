#!/bin/bash

# 公司订餐系统启动脚本

echo ""
echo "=========================================="
echo "         公司订餐系统启动脚本"
echo "=========================================="
echo ""

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到Node.js，请先安装Node.js"
    echo "Ubuntu/Debian: sudo apt install nodejs npm"
    echo "CentOS/RHEL: sudo yum install nodejs npm"
    echo "macOS: brew install node"
    exit 1
fi

# 显示Node.js版本
echo "[信息] Node.js版本:"
node --version
echo ""

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "[信息] 检测到未安装依赖，正在安装..."
    npm install
    echo ""
fi

# 创建必要目录
if [ ! -d "data" ]; then
    echo "[信息] 创建数据目录..."
    mkdir -p data
fi

if [ ! -d "logs" ]; then
    mkdir -p logs
fi

# 设置权限
chmod 755 data
chmod 755 logs

echo "[信息] 正在启动订餐系统..."
echo "[信息] 用户端访问地址: http://localhost:3000"
echo "[信息] 管理后台地址: http://localhost:3000/admin.html"
echo "[信息] 按 Ctrl+C 停止服务"
echo ""
echo "=========================================="
echo "               系统启动中..."
echo "=========================================="
echo ""

# 启动服务器
node server.js