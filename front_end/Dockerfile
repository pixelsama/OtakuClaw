# 多阶段构建：构建阶段
# 使用仓库根目录作为 build context，例如：
# docker build -f front_end/Dockerfile .
FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

# 复制 workspace 与依赖描述文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY front_end/package.json front_end/package.json

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY front_end ./front_end

WORKDIR /app/front_end

# 构建应用
RUN pnpm run build

# 生产阶段：使用nginx服务静态文件
FROM nginx:alpine

# 复制构建产物到nginx目录
COPY --from=builder /app/front_end/dist /usr/share/nginx/html

# 复制nginx配置
COPY front_end/nginx.conf /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 80

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]
