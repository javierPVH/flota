# Front de GESTIÓN (SPA Vite/React). Build en el monorepo (necesita @flota/ui)
# y servido como estáticos por nginx. CONTEXT = raíz del monorepo `flota/`.
#
#   docker build -f front-gestion/Dockerfile -t flota-front-gestion .

# --- 1) Build -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# package.json de la raíz + de TODOS los workspaces (npm ci los necesita todos)
# y el lockfile. Se copian antes que el código para cachear `npm ci`.
COPY package.json package-lock.json ./
COPY front/package.json front/
COPY front-gestion/package.json front-gestion/
COPY front-conductores/package.json front-conductores/
RUN npm ci

# Código: la librería compartida y este front.
COPY front/ front/
COPY front-gestion/ front-gestion/

# @flota/ui primero (genera front/dist), luego el front de gestión.
# VITE_BACKEND_BASE_URL vacío ⇒ el SPA usa rutas relativas (/api) ⇒ mismo dominio.
ENV VITE_BACKEND_BASE_URL=""
RUN npm run build:ui \
    && npm run build --workspace front-gestion

# --- 2) Servir estáticos --------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY front-gestion/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front-gestion/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
