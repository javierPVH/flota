# Front de CONDUCTORES (SPA Vite/React). Build en el monorepo (necesita @flota/ui)
# y servido como estáticos por nginx. CONTEXT = raíz del monorepo `flota/`.
#
#   docker build -f front-conductores/Dockerfile -t flota-front-conductores .

# --- 1) Build -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY front/package.json front/
COPY front-gestion/package.json front-gestion/
COPY front-conductores/package.json front-conductores/
RUN npm ci

COPY front/ front/
COPY front-conductores/ front-conductores/

# VITE_BACKEND_BASE_URL vacío ⇒ rutas relativas (/api) ⇒ mismo dominio (nginx).
ENV VITE_BACKEND_BASE_URL=""
RUN npm run build:ui \
    && npm run build --workspace front-conductores

# --- 2) Servir estáticos --------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY front-conductores/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front-conductores/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
