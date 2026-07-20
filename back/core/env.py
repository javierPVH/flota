"""Helpers de lectura de variables de entorno con tipado y defaults seguros.

Puro Python (sin imports de Django) para poder usarse desde `config/settings.py`
en tiempo de carga. Convención: los booleanos aceptan 1/true/yes/on.
"""
import os


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int = 0) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    """Lista separada por comas; vacía → `default` (o [])."""
    raw = os.environ.get(name, "")
    items = [x.strip() for x in raw.split(",") if x.strip()]
    return items if items else (default or [])
