#!/bin/sh
# Arranque del contenedor.
# Si arranca como root (lo normal), prepara la carpeta de datos con los permisos correctos
# y después ejecuta la app como el usuario sin privilegios "node". Así no hace falta
# ningún chown manual en el host, aunque la carpeta la haya creado Docker como root.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    echo "Ajustando permisos de $DATA_DIR…"
    chown -R node:node "$DATA_DIR"
  fi
  exec su-exec node "$@"
fi

# Si alguien fuerza otro usuario (user: en docker-compose), se respeta tal cual.
exec "$@"
