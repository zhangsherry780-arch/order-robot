# 使用官方Node.js运行时镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖 (在构建阶段完成所有依赖安装)
RUN npm install --production --verbose && npm cache clean --force

# 复制应用的静态文件和配置
COPY server.js ./
COPY config/ ./config/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY database/ ./database/
COPY ecosystem.config.js ./
COPY feishu-config.js ./
COPY .env.production ./

# 创建必要的目录和权限
RUN mkdir -p data logs && \
    chown -R node:node /app && \
    chmod -R 755 /app && \
    chmod -R 775 /app/data /app/logs

# 切换到非root用户
USER node

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 启动应用
CMD ["node", "server.js"]