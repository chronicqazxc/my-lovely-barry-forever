FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
# The data dir must exist and belong to the unprivileged user BEFORE it becomes a volume,
# otherwise a fresh named volume is root-owned and the app can't write to it.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
