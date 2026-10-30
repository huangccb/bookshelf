# 资源书架 · 运行镜像
# 纯 JavaScript 依赖，无原生编译模块，因此可以直接带依赖拷进最终镜像
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# 依赖层单独缓存：package.json 不变时复用
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 应用代码与前端资源
COPY server.js db.js metadata.js epub_extract.js text_decode.js ./
COPY public ./public

# 书籍文件、封面与 data.json 都落在 /app/data，由数据卷持有
RUN mkdir -p /app/data/uploads /app/data/covers \
    && chown -R node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
