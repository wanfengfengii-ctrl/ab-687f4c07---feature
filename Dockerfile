# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 无第三方运行时依赖，直接拷贝源码
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node test ./test
COPY --chown=node:node scripts ./scripts

# 镜像构建期执行一次构建（含恒等网格自检），产物为 dist/
# 构建后把 /app 整体交给 node 用户：verify 服务在容器内会重新构建 dist/
RUN node scripts/build.js && chown -R node:node /app

USER node
EXPOSE 8080

# 容器级健康检查（Compose 健康检查亦依赖 /healthz）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
