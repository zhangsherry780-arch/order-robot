#!/bin/bash

# 文件同步脚本
# 用于将修改的文件同步到服务器

# SSH密码配置（请修改为实际密码）
SSH_PASSWORD="your_password_here"
export SSHPASS="$SSH_PASSWORD"

# 服务器配置（直接在脚本中配置）
SERVER_HOST="172.16.74.75"
SERVER_USER="root"
SERVER_PATH="/root/order-robot"

# 允许命令行参数覆盖默认配置
SERVER_HOST=${1:-$SERVER_HOST}
SERVER_USER=${2:-$SERVER_USER}
SERVER_PATH=${3:-$SERVER_PATH}

echo "🚀 开始同步文件到服务器..."
echo "目标服务器: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"

# 检查并创建目标目录
echo "📁 检查目标目录..."
ssh "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_PATH}"

# 需要同步的文件和目录
SYNC_ITEMS=(
    "server.js"
    "config/"
    "public/"
    "database/"
    "scripts/"
    "libs/"
    "data/"
    ".env.production"
    "ecosystem.config.js"
    "feishu-config.js"
    "auto-sync-monitor.js"
    "fix-data-sync.js"
    "fix-no-eat-sync.js"
    "create-future-orders.js"
    "docker-compose.yml"
    "deploy-offline.sh"
    "fix-permissions.sh"
    "package.json"
    "package-lock.json"
)

# 检测并使用最佳同步工具
echo "📁 同步文件..."
if command -v rsync >/dev/null 2>&1; then
    # 使用rsync（支持增量同步）
    echo "  使用rsync同步..."
    rsync -avz --progress "${SYNC_ITEMS[@]}" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
else
    # 使用tar打包+scp传输（只需一次密码）
    echo "  打包文件进行批量传输..."
    TAR_FILE="sync-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "$TAR_FILE" "${SYNC_ITEMS[@]}" 2>/dev/null

    echo "  上传并解压..."
    scp "$TAR_FILE" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
    ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && tar -xzf $TAR_FILE && rm $TAR_FILE"

    echo "  清理本地临时文件..."
    rm "$TAR_FILE"
fi

# 修复脚本文件的行尾符 (Windows -> Linux)
echo "🔧 修复脚本文件格式..."
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && dos2unix *.sh 2>/dev/null || sed -i 's/\r$//' *.sh"

# 修复文件和目录权限 (关键：解决Windows->Linux用户ID问题)
echo "🔐 修复文件权限..."
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && \
    chmod +x *.sh && \
    echo '  设置脚本执行权限完成' && \
    sudo chown -R 1000:1000 data logs 2>/dev/null || chown -R 1000:1000 data logs 2>/dev/null && \
    echo '  修复文件所有者完成(1000:1000)' && \
    chmod -R 775 data logs 2>/dev/null && \
    echo '  设置目录权限完成(775)' && \
    find data -name '*.json' -type f -exec chmod 664 {} \; 2>/dev/null && \
    echo '  设置JSON文件权限完成(664)' && \
    echo '✅ 权限修复完成'"

# 检查是否首次部署（服务器上没有容器）
echo "🔍 检查服务器状态..."
if ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && docker-compose ps order-robot 2>/dev/null | grep -q order-robot"; then
    echo "🔄 重启现有服务..."
    ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && docker-compose restart order-robot"
else
    echo "⚠️  未检测到运行中的服务"
    echo "如果这是首次部署，请先手动上传Docker镜像文件并运行:"
    echo "  scp order-robot-*.tar.gz ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}/"
    echo "  ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${SERVER_PATH} && chmod +x deploy-offline.sh && ./deploy-offline.sh'"
fi

echo "✅ 文件同步完成！"
echo ""
echo "🔍 检查服务状态:"
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_PATH} && docker-compose ps"