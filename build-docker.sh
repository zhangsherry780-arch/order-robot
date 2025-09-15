#!/bin/bash

# Docker构建和部署脚本
# 用于在联网环境构建Docker镜像

set -e

echo "🚀 开始构建Docker镜像..."

# 设置镜像名称和版本
IMAGE_NAME="order-robot"
VERSION=${1:-latest}
FULL_IMAGE_NAME="${IMAGE_NAME}:${VERSION}"

# 构建Docker镜像
echo "📦 构建镜像: ${FULL_IMAGE_NAME}"
docker build -t ${FULL_IMAGE_NAME} .

# 如果不是latest版本，同时打latest标签
if [ "${VERSION}" != "latest" ]; then
    echo "🏷️  添加latest标签"
    docker tag ${FULL_IMAGE_NAME} ${IMAGE_NAME}:latest
fi

# 创建镜像tar文件用于离线部署
TAR_FILE="order-robot-${VERSION}.tar"
echo "💾 导出镜像到: ${TAR_FILE}"
docker save -o ${TAR_FILE} ${FULL_IMAGE_NAME}

# 压缩tar文件以减少传输大小
echo "🗜️  压缩镜像文件..."
gzip -f ${TAR_FILE}

echo "✅ 构建完成！"
echo ""
echo "📋 部署说明："
echo "1. 将以下文件上传到服务器："
echo "   - ${TAR_FILE}.gz (Docker镜像)"
echo "   - docker-compose.yml (容器编排文件)"
echo "   - deploy-offline.sh (离线部署脚本)"
echo "   - 以及所有需要挂载的代码文件"
echo ""
echo "2. 在服务器上运行: ./deploy-offline.sh ${VERSION}"

# 显示镜像信息
echo ""
echo "🔍 镜像信息："
docker images ${IMAGE_NAME} --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# 检查文件大小
if [ -f "${TAR_FILE}.gz" ]; then
    FILE_SIZE=$(du -h "${TAR_FILE}.gz" | cut -f1)
    echo "📦 压缩后文件大小: ${FILE_SIZE}"
fi