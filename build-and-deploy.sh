#!/bin/bash

# 本地构建Docker镜像并部署到服务器

set -e

echo "🚀 Docker镜像构建和部署脚本"
echo "============================"

# 配置信息
SERVER_USER="root"
SERVER_HOST="172.16.74.75"
IMAGE_NAME="order-robot"
IMAGE_TAG="latest"
PROJECT_NAME="order-robot"

echo "📡 部署信息:"
echo "   服务器: $SERVER_HOST"
echo "   用户: $SERVER_USER"
echo "   镜像: $IMAGE_NAME:$IMAGE_TAG"
echo ""

# 确认部署
read -p "🔄 确认开始构建和部署？(y/N): " confirm
if [[ $confirm != [yY] ]]; then
    echo "❌ 部署已取消"
    exit 0
fi

echo "🔧 步骤1: 本地构建Docker镜像..."
docker build -t $IMAGE_NAME:$IMAGE_TAG .

if [ $? -ne 0 ]; then
    echo "❌ Docker镜像构建失败"
    exit 1
fi

echo "✅ Docker镜像构建完成"

echo "📦 步骤2: 导出Docker镜像..."
docker save -o ${IMAGE_NAME}.tar $IMAGE_NAME:$IMAGE_TAG

if [ $? -ne 0 ]; then
    echo "❌ Docker镜像导出失败"
    exit 1
fi

echo "✅ Docker镜像导出完成: ${IMAGE_NAME}.tar"

echo "⬆️ 步骤3: 上传文件到服务器..."

# 上传镜像文件
echo "上传Docker镜像..."
scp ${IMAGE_NAME}.tar $SERVER_USER@$SERVER_HOST:~/

# 上传docker-compose文件
echo "上传docker-compose.yml..."
scp docker-compose.yml $SERVER_USER@$SERVER_HOST:~/

# 上传数据目录结构（如果存在）
if [ -d "data" ]; then
    echo "上传数据目录..."
    scp -r data $SERVER_USER@$SERVER_HOST:~/
fi

# 清理本地临时文件
rm -f ${IMAGE_NAME}.tar

echo "✅ 文件上传完成"

echo "🚀 步骤4: 在服务器上部署..."

ssh $SERVER_USER@$SERVER_HOST << EOF
#!/bin/bash
set -e

echo "🐳 在服务器上部署Docker应用..."

# 检查Docker是否安装
if ! command -v docker >/dev/null 2>&1; then
    echo "📦 安装Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker安装完成"
else
    echo "✅ Docker已安装: \$(docker --version)"
fi

# 检查docker-compose是否安装
if ! command -v docker-compose >/dev/null 2>&1; then
    echo "📦 安装Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose安装完成"
else
    echo "✅ Docker Compose已安装: \$(docker-compose --version)"
fi

# 停止现有容器
if [ -f docker-compose.yml ]; then
    echo "⏹️ 停止现有容器..."
    docker-compose down 2>/dev/null || echo "没有运行的容器"
fi

# 加载Docker镜像
echo "📦 加载Docker镜像..."
docker load -i ${IMAGE_NAME}.tar

# 创建必要目录
echo "📁 创建项目目录..."
mkdir -p data logs

# 启动应用
echo "🚀 启动应用..."
docker-compose up -d

# 检查容器状态
echo "📋 检查容器状态..."
docker-compose ps

# 显示日志
echo "📄 应用日志:"
docker-compose logs --tail=20

# 清理镜像文件
rm -f ${IMAGE_NAME}.tar

echo ""
echo "🎉 Docker部署完成！"
echo ""
echo "📋 有用的命令："
echo "   查看状态: docker-compose ps"
echo "   查看日志: docker-compose logs -f"
echo "   重启应用: docker-compose restart"
echo "   停止应用: docker-compose down"
echo ""
echo "🌐 访问地址: http://$SERVER_HOST:3000"

EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 部署成功完成！"
    echo "🌐 应用地址: http://$SERVER_HOST:3000"
else
    echo "❌ 部署失败，请检查错误信息"
    exit 1
fi