#!/bin/bash

# 修复Docker权限问题的脚本

echo "🔧 修复Docker容器文件权限问题..."

# 停止容器
echo "⏸️  停止容器..."
docker-compose down

# 修复宿主机目录权限
echo "🔐 修复宿主机目录权限..."

# 方法1: 尝试使用sudo设置权限
if sudo chmod -R 775 data logs 2>/dev/null; then
    echo "  ✓ 使用sudo设置目录权限成功"
    sudo find data -name '*.json' -type f -exec chmod 664 {} \; 2>/dev/null
    echo "  ✓ JSON文件权限设置完成"
else
    echo "⚠️  sudo权限设置失败，尝试其他方法..."

    # 方法2: 普通用户权限设置
    if chmod -R 755 data logs 2>/dev/null; then
        echo "  ✓ 普通用户权限设置成功"
        find data -name '*.json' -type f -exec chmod 644 {} \; 2>/dev/null
    else
        echo "  ❌ 权限设置失败"
        echo "  请手动运行: sudo chmod -R 775 data logs"
    fi
fi

# 检查Docker容器内的用户ID (通常是1000:1000)
echo "📋 检查容器用户信息..."
CONTAINER_USER_INFO=$(docker-compose exec -T order-robot id 2>/dev/null || echo "容器未运行")
echo "  容器内用户: $CONTAINER_USER_INFO"

# 尝试匹配宿主机权限到容器用户
if command -v chown >/dev/null 2>&1; then
    sudo chown -R 1000:1000 data logs 2>/dev/null && echo "  ✓ 设置所有者为容器用户(1000:1000)" || echo "  ⚠️  无法更改所有者"
fi

# 确保文件存在并可访问
echo "📄 检查数据文件..."
for file in data/*.json; do
    if [ -f "$file" ]; then
        echo "  ✓ $file 存在"
        ls -la "$file"
    else
        echo "  ⚠️  $file 不存在"
    fi
done

# 重新启动容器
echo "🚀 重新启动容器..."
docker-compose up -d

echo "✅ 权限修复完成！"
echo ""
echo "检查容器状态:"
docker-compose ps
echo ""
echo "检查容器日志:"
docker-compose logs --tail 10 order-robot