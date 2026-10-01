# 云顶山观光车平台 · 后端镜像（NestJS + TypeORM/SQLite）
FROM node:22-alpine

# better-sqlite3 为原生模块，需要本地编译工具链
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 安装依赖（含 devDependencies，用于 tsc 构建）
COPY package*.json ./
RUN npm ci --include=dev

COPY . .
# 编译 TypeScript 到 dist/
RUN npx tsc -p tsconfig.json && mkdir -p data

ENV NODE_ENV=production
ENV PORT=3001
ENV SQLITE_PATH=/app/data/app.sqlite
EXPOSE 3001

# 首次启动自动建表并写入演示种子数据
CMD ["node", "dist/main.js"]
