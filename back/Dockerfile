# Backend Flota (Django + DRF) servido con gunicorn en producción.
FROM python:3.13-slim AS runtime

# - PYTHONUNBUFFERED: logs sin buffer (se ven en `docker logs` al instante).
# - PIP_NO_CACHE_DIR: imagen más pequeña.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# `curl` para el HEALTHCHECK; el resto de dependencias traen wheels (no compilan).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Requisitos primero: aprovecha la caché de capas si no cambian.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Código de la aplicación.
COPY . .

# Usuario sin privilegios y carpeta de datos (media y estáticos; la BD es el
# servicio PostgreSQL del compose) con permisos.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data/media /app/data/staticfiles \
    && chown -R appuser:appuser /app \
    && chmod +x /app/entrypoint.sh
USER appuser

EXPOSE 8000

# Sonda de salud del propio contenedor (liveness). No toca BD.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS -H "X-Forwarded-Proto: https" http://127.0.0.1:8000/api/health/ || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
