# 云顶山观光车调度平台 —— 后端镜像（NestJS + TypeORM/SQLite）
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# better-sqlite3 无可用预编译包时可本地编译
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# better-sqlite3 的运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
# 容器内从编译产物启动（SQLite 默认落在 /app/data/app.sqlite）
CMD ["node", "dist/main.js"]
