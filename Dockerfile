ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY skills/ ./skills/
COPY openclaw-plugin/package.json ./openclaw-plugin/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=apps/cli --include-workspace-root=false \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown node:node /data
ENV NODE_ENV=production JS_EYES_HOME=/data
USER node
EXPOSE 18080
CMD ["node", "apps/cli/bin/js-eyes.js", "server", "start", "--foreground", "--host", "0.0.0.0", "--port", "18080"]
