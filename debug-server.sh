#!/bin/bash

# 服务器部署问题诊断脚本
# 在服务器上运行此脚本来诊断权限和环境问题

echo "🔍 Ubuntu 服务器环境诊断"
echo "========================="

# 1. 检查系统信息
echo "📋 系统信息:"
echo "   操作系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d '"' -f 2)"
echo "   内核版本: $(uname -r)"
echo "   用户权限: $(whoami)"
echo "   用户ID: $(id)"
echo ""

# 2. 检查磁盘空间
echo "💾 磁盘空间:"
df -h /
echo ""

# 3. 检查 /var 目录权限
echo "🔐 /var 目录权限:"
ls -la /var/ | grep www || echo "   /var/www 目录不存在"
echo ""

# 4. 检查文件系统是否只读
echo "📁 文件系统状态:"
mount | grep " / " | grep ro && echo "   ⚠️ 根文件系统是只读模式!" || echo "   ✅ 文件系统可写"
echo ""

# 5. 尝试创建目录的不同方法
echo "🧪 目录创建测试:"

# 测试1: 检查 /var 是否可写
if [ -w /var ]; then
    echo "   ✅ /var 目录可写"
else
    echo "   ❌ /var 目录不可写"
fi

# 测试2: 先创建 /var/www
echo "   尝试创建 /var/www..."
if mkdir -p /var/www 2>/dev/null; then
    echo "   ✅ /var/www 创建成功"
    ls -la /var/ | grep www
else
    echo "   ❌ /var/www 创建失败"
fi

# 测试3: 尝试创建目标目录
echo "   尝试创建 /var/www/order-robot..."
if mkdir -p /var/www/order-robot 2>/dev/null; then
    echo "   ✅ /var/www/order-robot 创建成功"
    ls -la /var/www/ | grep order-robot
else
    echo "   ❌ /var/www/order-robot 创建失败"
    echo "   详细错误："
    mkdir -p /var/www/order-robot 2>&1
fi

# 测试4: 检查 SELinux 状态 (如果存在)
echo ""
echo "🛡️ 安全策略检查:"
if command -v getenforce >/dev/null 2>&1; then
    echo "   SELinux 状态: $(getenforce)"
else
    echo "   SELinux 未安装"
fi

# 检查 AppArmor 状态
if command -v aa-status >/dev/null 2>&1; then
    echo "   AppArmor 状态: $(aa-status --enabled && echo "启用" || echo "禁用")"
else
    echo "   AppArmor 未安装"
fi

# 5. 替代方案测试
echo ""
echo "🔄 替代目录方案:"

# 方案1: 使用用户home目录
HOME_DIR="$HOME/order-robot"
echo "   测试 home 目录: $HOME_DIR"
if mkdir -p "$HOME_DIR" 2>/dev/null; then
    echo "   ✅ Home 目录可用: $HOME_DIR"
    rmdir "$HOME_DIR" 2>/dev/null
else
    echo "   ❌ Home 目录不可用"
fi

# 方案2: 使用 /opt 目录
OPT_DIR="/opt/order-robot"
echo "   测试 /opt 目录: $OPT_DIR"
if mkdir -p "$OPT_DIR" 2>/dev/null; then
    echo "   ✅ /opt 目录可用: $OPT_DIR"
    rmdir "$OPT_DIR" 2>/dev/null
else
    echo "   ❌ /opt 目录不可用"
fi

# 方案3: 使用 /usr/local 目录
LOCAL_DIR="/usr/local/order-robot"
echo "   测试 /usr/local 目录: $LOCAL_DIR"
if mkdir -p "$LOCAL_DIR" 2>/dev/null; then
    echo "   ✅ /usr/local 目录可用: $LOCAL_DIR"
    rmdir "$LOCAL_DIR" 2>/dev/null
else
    echo "   ❌ /usr/local 目录不可用"
fi

echo ""
echo "🎯 建议解决方案:"
echo "================================="

# 建议解决方案
if [ -w /var/www ] 2>/dev/null || mkdir -p /var/www 2>/dev/null; then
    echo "1. ✅ 使用标准路径: /var/www/order-robot"
elif mkdir -p /opt/order-robot 2>/dev/null; then
    echo "1. 🔄 使用替代路径: /opt/order-robot"
    echo "   需要修改部署脚本中的 SERVER_PATH"
    rmdir /opt/order-robot 2>/dev/null
elif mkdir -p "$HOME/order-robot" 2>/dev/null; then
    echo "1. 🏠 使用用户目录: $HOME/order-robot"  
    echo "   需要修改部署脚本中的 SERVER_PATH"
    rmdir "$HOME/order-robot" 2>/dev/null
else
    echo "1. ❌ 所有标准路径都不可用，需要手动排查"
fi

echo ""
echo "🛠️ 修复步骤:"
echo "1. 如果是磁盘空间问题，清理磁盘空间"
echo "2. 如果是只读文件系统，重新挂载为可写："
echo "   sudo mount -o remount,rw /"
echo "3. 如果是权限问题，检查当前用户权限："
echo "   sudo -i  # 切换到真正的root用户"
echo "4. 如果是安全策略问题，临时禁用或配置相应策略"
echo ""
echo "完成诊断! 🎉"