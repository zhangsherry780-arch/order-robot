#!/bin/bash

# 离线部署脚本
# 在没有网络的服务器上运行此脚本部署应用

set -e

VERSION=${1:-latest}
IMAGE_FILE="order-robot-${VERSION}.tar.gz"

echo "🚀 开始离线部署 order-robot:${VERSION}"

# 检查文件是否存在
if [ ! -f "${IMAGE_FILE}" ]; then
    echo "❌ 错误: 找不到镜像文件 ${IMAGE_FILE}"
    echo "请确保已上传镜像文件到当前目录"
    exit 1
fi

if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 找不到 docker-compose.yml 文件"
    exit 1
fi

# 检查必要的目录是否存在
echo "📁 检查项目目录结构..."
REQUIRED_DIRS=("config" "public" "database" "scripts")
REQUIRED_FILES=("server.js" ".env.production" "ecosystem.config.js")

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        echo "⚠️  警告: 目录 $dir 不存在，创建空目录"
        mkdir -p "$dir"
    fi
done

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "⚠️  警告: 文件 $file 不存在"
    fi
done

# 创建数据和日志目录
echo "📁 创建数据和日志目录..."
mkdir -p data logs

# 设置目录权限 (确保Docker容器内的node用户可以写入)
echo "🔐 设置目录权限..."
# 修复所有者为Docker容器内的node用户(1000:1000)
chown -R 1000:1000 data logs 2>/dev/null || sudo chown -R 1000:1000 data logs 2>/dev/null || echo "  ⚠️  无法设置文件所有者"
# 设置权限
chmod -R 775 data logs 2>/dev/null || echo "  ⚠️  权限设置可能需要管理员权限"
echo "  ✓ 权限配置完成"

# 解压并加载Docker镜像
echo "📦 加载Docker镜像..."
gunzip -c "${IMAGE_FILE}" | docker load

# 如果加载的不是latest版本，更新latest标签
if [ "${VERSION}" != "latest" ]; then
    echo "🏷️  更新latest标签到version ${VERSION}"
    docker tag order-robot:${VERSION} order-robot:latest
fi

# 清理未使用的旧镜像
echo "🧹 清理未使用的镜像..."
docker image prune -f

# 可选：清理order-robot的旧版本（保留当前版本和latest）
echo "🗑️  清理order-robot旧版本..."
OLD_IMAGES=$(docker images order-robot --format "{{.Repository}}:{{.Tag}}" | grep -v ":${VERSION}$" | grep -v ":latest$" | head -n 3)
if [ ! -z "$OLD_IMAGES" ]; then
    echo "删除旧版本: $OLD_IMAGES"
    echo "$OLD_IMAGES" | xargs -r docker rmi 2>/dev/null || true
else
    echo "没有需要清理的旧版本"
fi

# 停止现有容器（如果存在）
echo "🛑 停止现有容器..."
docker-compose down --remove-orphans || true

# 启动新容器
echo "🚀 启动容器..."
docker-compose up -d

# 等待容器启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查容器状态
echo "🔍 检查容器状态..."
docker-compose ps

# 检查服务健康状态
echo "🏥 检查服务健康状态..."
for i in {1..30}; do
    if curl -f http://localhost:3000/ > /dev/null 2>&1; then
        echo "✅ 服务启动成功！"
        echo "🌐 应用访问地址: http://localhost:3000"
        break
    else
        echo "⏳ 等待服务启动... (${i}/30)"
        sleep 2
    fi

    if [ $i -eq 30 ]; then
        echo "❌ 服务启动失败或超时"
        echo "查看日志:"
        docker-compose logs order-robot
        exit 1
    fi
done

echo "🎉 部署完成！"
echo ""
echo "📋 常用命令:"
echo "  查看日志: docker-compose logs -f order-robot"
echo "  重启服务: docker-compose restart order-robot"
echo "  停止服务: docker-compose down"
echo "  查看状态: docker-compose ps"