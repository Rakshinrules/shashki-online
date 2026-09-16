FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server.mjs store.mjs ./
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3077 DB_PATH=/data/events.sqlite
EXPOSE 3077
CMD ["node", "server.mjs"]
