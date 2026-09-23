FROM node:24.21.0-alpine
ENV NODE_ENV=production PORT=3000 PUBLIC_DIR=/app/public DATABASE_PATH=/app/data/contacts.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./server/
COPY admin/ ./admin/
COPY scripts/backup.mjs ./scripts/backup.mjs
COPY scripts/hash-password.mjs ./scripts/hash-password.mjs
COPY scripts/reset-admin-password.mjs ./scripts/reset-admin-password.mjs
COPY *.html ./public/
COPY en/ ./public/en/
COPY fr/ ./public/fr/
COPY de/ ./public/de/
COPY assets/css/ ./public/assets/css/
COPY assets/js/ ./public/assets/js/
COPY assets/img/web/ ./public/assets/img/web/
COPY assets/img/logo-placeholder.svg ./public/assets/img/logo-placeholder.svg
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
