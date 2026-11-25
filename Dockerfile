# ---------- 1. Compilación ----------
# Se compila en la arquitectura de la máquina que construye (el resultado es JavaScript y vale para
# cualquiera): así la imagen ARM de GitHub Actions no compila emulada, que es lento y falla a veces.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci
COPY packages packages
COPY apps apps
# El historial de cambios va dentro de la web («Novedades» en el menú)
COPY CHANGELOG.md ./
RUN npm run build

# ---------- 2. Dependencias de producción ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --omit=dev --workspace @agendario/server --include-workspace-root=false

# ---------- 3. Imagen final ----------
FROM node:22-alpine
# rclone: copias de seguridad en SMB y Google Drive · tzdata: hora local de las copias
RUN apk add --no-cache su-exec rclone tzdata ca-certificates
ARG APP_VERSION=1.3.0
# App de Google para conectar Google Drive (la imagen de Docker Hub la recibe de los secretos de GitHub)
ARG GOOGLE_CLIENT_ID=""
ARG GOOGLE_CLIENT_SECRET=""
ENV GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID} \
    GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
ENV NODE_ENV=production \
    PORT=3002 \
    DATA_DIR=/data \
    APP_VERSION=${APP_VERSION}
WORKDIR /app/apps/server

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/server/package.json ./
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
