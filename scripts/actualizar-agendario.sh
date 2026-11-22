#!/bin/bash
# actualizar-agendario.sh — instala o actualiza Agendario a partir de un zip y, si quieres, lo sube a GitHub
#
# Uso:  bash /opt/actualizar-agendario.sh
#
# Qué hace:
#   1. Busca el ÚNICO agendario-*.zip que haya en /opt. Si hay cero o varios, se para y te lo dice.
#   2. Lo descomprime en /var/tmp/agendario-build (borrando antes lo de la vez anterior).
#   3. Construye la imagen  agendario-local
#   4. Recrea los contenedores en /opt/agendario (no se tocan ni el .env ni la carpeta data).
#      El docker-compose.yml se sincroniza siempre con el de la versión (guarda copia del anterior).
#      La primera vez crea /opt/agendario con su docker-compose.yml y un .env con contraseña aleatoria.
#   5. Si al empezar dices que sí, sube el código a GitHub (commit + push + etiqueta; las betas van a la rama «beta»)
#   6. Borra el zip (si algo falla, el zip se conserva) y se actualiza a sí mismo con la versión del zip
#
# La configuración de GitHub va aparte, en /opt/agendario/actualizar.conf
# (siempre tienes un ejemplo al lado: /opt/agendario/actualizar.conf.example).
# Si no existe, el script te lo dice y actualiza solo en local.
#
# Variables opcionales:  BASE=/opt  APP_DIR=/opt/agendario  BUILD=/var/tmp/agendario-build

BASE="${BASE:-/opt}"
APP_DIR="${APP_DIR:-$BASE/agendario}"
BUILD="${BUILD:-/var/tmp/agendario-build}"   # fuera de /opt para que Arcane no lo vea como proyecto
CONF="$APP_DIR/actualizar.conf"
IMAGE="agendario-local"
SELF="$(readlink -f "$0")"

fallo() { echo; echo "✗ $1"; exit 1; }
si() { case "$1" in s|S|si|SI|sí|Sí|SÍ) return 0;; *) return 1;; esac; }

# ---- comprobaciones previas ----
[ "$(id -u)" -eq 0 ] || fallo "Ejecútalo como root."
if [ -z "$SKIP_DOCKER" ]; then
  command -v docker >/dev/null || fallo "No encuentro docker."
  docker compose version >/dev/null 2>&1 || fallo "No encuentro «docker compose»."
fi
command -v unzip >/dev/null || fallo "Falta unzip. Instálalo con:  apt install -y unzip"
command -v curl >/dev/null || fallo "Falta curl. Instálalo con:  apt install -y curl"

shopt -s nullglob
ZIPS=("$BASE"/agendario-*.zip)
shopt -u nullglob
[ "${#ZIPS[@]}" -eq 1 ] || fallo "Tiene que haber exactamente UN agendario-*.zip en $BASE y hay ${#ZIPS[@]}${ZIPS[*]:+: ${ZIPS[*]}}"
ZIP="${ZIPS[0]}"
ZV="$(unzip -p "$ZIP" agendario/package.json 2>/dev/null | grep -m1 '"version"' | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
[ -n "$ZV" ] || fallo "El zip $ZIP no parece de Agendario (no tiene agendario/package.json)."

PRIMERA=n
[ -f "$APP_DIR/docker-compose.yml" ] || PRIMERA=s

# ---- primera instalación con una instalación antigua de «Contactos» al lado: ¿copiar sus datos? ----
OLD_DIR="${OLD_DIR:-$BASE/contactos}"
MIGRAR=n
if [ "$PRIMERA" = s ] && [ -f "$OLD_DIR/docker-compose.yml" ]; then
  echo "ℹ Hay una instalación antigua de Contactos en $OLD_DIR."
  printf "¿Copio sus datos a Agendario (contactos, usuarios, fotos, historial, copias y ajustes)? (s/n) "
  read -r R
  if si "$R"; then
    MIGRAR=s
    mkdir -p "$APP_DIR"
    [ -f "$OLD_DIR/actualizar.conf" ] && [ ! -f "$APP_DIR/actualizar.conf" ] && cp "$OLD_DIR/actualizar.conf" "$APP_DIR/actualizar.conf" && chmod 600 "$APP_DIR/actualizar.conf" && echo "  actualizar.conf (GitHub) copiado de $OLD_DIR"
    echo "  La instalación antigua no se borra: se para al final de la copia y queda en $OLD_DIR por si hiciera falta."
  fi
fi

# ---- el docker-compose.yml se sincroniza SIEMPRE con el de la versión nueva ----
# (tus ajustes van en el .env, que nunca se toca; así no quedan compose antiguos con otro puerto o imagen)
if [ "$PRIMERA" = n ]; then
  NUEVO_COMPOSE="$(mktemp)"
  unzip -p "$ZIP" agendario/docker-compose.yml > "$NUEVO_COMPOSE"
  if ! cmp -s "$NUEVO_COMPOSE" "$APP_DIR/docker-compose.yml"; then
    BAK="$APP_DIR/docker-compose.yml.$(date +%F-%H%M).bak"
    cp "$APP_DIR/docker-compose.yml" "$BAK"
    echo "ℹ El docker-compose.yml de $APP_DIR no coincide con el de la versión nueva. Lo sustituyo."
    echo "  Copia del anterior: $BAK"
    echo "  Cambios (− el tuyo, + el nuevo):"
    diff -u "$BAK" "$NUEVO_COMPOSE" | grep -E '^[-+][^-+]' | sed 's/^/    /' | head -20 || true
    cp "$NUEVO_COMPOSE" "$APP_DIR/docker-compose.yml"
  fi
  rm -f "$NUEVO_COMPOSE"
  # .env de una instalación antigua con el puerto 3000 (lo usan PVEMon/BCKMon)
  if grep -Eq '^APP_PORT=3000[[:space:]]*$' "$APP_DIR/.env" 2>/dev/null; then
    printf "Tu .env tiene APP_PORT=3000. ¿Lo cambio a 3002? (s/n) "
    read -r R
    if si "$R"; then sed -i 's/^APP_PORT=3000[[:space:]]*$/APP_PORT=3002/' "$APP_DIR/.env"; echo "  hecho"; fi
  fi
fi

# ---- ¿subir también a GitHub? (se pregunta ahora, antes de empezar) ----
SUBIR=n; OLD_TAG=""
if [ ! -f "$CONF" ]; then
  echo "ℹ No existe la configuración de GitHub ($CONF): solo se actualiza en local."
  echo "  Cuando quieras subir a GitHub:  cp $APP_DIR/actualizar.conf.example $CONF   y rellénalo."
  [ "$PRIMERA" = s ] && echo "  (el ejemplo se crea en esta primera instalación)"
else
  # shellcheck disable=SC1090
  . "$CONF"
  REPO="${REPO:-/root/agendario-repo}"
  if [ -z "$GITHUB_URL" ]; then
    echo "ℹ En $CONF no hay GITHUB_URL: solo se actualiza en local."
  else
    printf "¿Subir también el código a GitHub al terminar? (s/n) "
    read -r R
    si "$R" && SUBIR=s
  fi
fi
# Con GITHUB_TOKEN en actualizar.conf, git usa ese token sin guardarlo en ningún sitio ni mostrarlo
gh() {
  if [ -n "$GITHUB_TOKEN" ]; then
    GITHUB_TOKEN="$GITHUB_TOKEN" git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f' "$@"
  else
    git "$@"
  fi
}
if [ "$SUBIR" = s ]; then
  command -v git >/dev/null || fallo "Falta git. Instálalo con:  apt install -y git"
  if [ ! -d "$REPO/.git" ]; then
    echo "  No hay clon del repositorio en $REPO; lo clono de $GITHUB_URL…"
    gh clone -q "$GITHUB_URL" "$REPO" || fallo "No he podido clonar $GITHUB_URL (¿existe el repositorio? ¿token o credenciales?)."
  fi
  [ -n "$GIT_NAME" ] && git -C "$REPO" config user.name "$GIT_NAME"
  [ -n "$GIT_EMAIL" ] && git -C "$REPO" config user.email "$GIT_EMAIL"
  git -C "$REPO" config http.postBuffer 524288000   # pushes grandes (manual PDF) sin error 408
  [ -n "$(git -C "$REPO" config user.name)" ] && [ -n "$(git -C "$REPO" config user.email)" ] || fallo "Git no sabe quién eres. Pon GIT_NAME y GIT_EMAIL en $CONF  o ejecuta:  git config --global user.name \"Tu nombre\"  y  git config --global user.email \"tu@correo\""
  gh -C "$REPO" ls-remote -q origin >/dev/null 2>&1 || fallo "No consigo hablar con GitHub desde $REPO (¿credenciales?). Prueba a mano:  cd $REPO && git ls-remote origin"
  case "$ZV" in
    *-*) echo "  Es una beta ($ZV): irá a la rama «beta» y no se borra ninguna etiqueta.";;
    *)   printf "  Es una versión estable ($ZV) y irá a «main». ¿Versión anterior cuya etiqueta se borra? (Enter = ninguna) "
         read -r OLD_TAG;;
  esac
fi

echo
echo "Zip:        $ZIP  (versión $ZV)"
echo "Carpeta:    $BUILD"
echo "Agendario:  $APP_DIR$( [ "$PRIMERA" = s ] && echo "  (primera instalación)")"
echo

set -e

# ---- 1. descomprimir ----
echo "▶ Descomprimiendo…"
rm -rf "$BUILD"
mkdir -p "$BUILD"
unzip -q "$ZIP" -d "$BUILD"
SRC="$BUILD/agendario"
[ -d "$SRC" ] || fallo "El zip no tiene la carpeta agendario dentro."
VERSION="$(grep -m1 '"version"' "$SRC/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
echo "  versión: $VERSION"
NEW_SELF=""
if [ -f "$SRC/scripts/actualizar-agendario.sh" ]; then NEW_SELF="$SELF.nuevo"; cp "$SRC/scripts/actualizar-agendario.sh" "$NEW_SELF"; fi

# ---- 2. preparar /opt/agendario ----
mkdir -p "$APP_DIR"
if [ "$PRIMERA" = s ]; then
  echo "▶ Primera instalación: creando $APP_DIR…"
  cp "$SRC/docker-compose.yml" "$APP_DIR/"
fi
if [ ! -f "$APP_DIR/.env" ] && [ "$MIGRAR" = s ] && [ -f "$OLD_DIR/.env" ]; then
  # Se conservan tus ajustes (puerto, registro, cookies…), con una contraseña nueva para la base de datos nueva
  cp "$OLD_DIR/.env" "$APP_DIR/.env"
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|" "$APP_DIR/.env"
  echo "  .env copiado de $OLD_DIR (con una contraseña nueva para la base de datos)"
fi
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$SRC/.env.example" "$APP_DIR/.env"
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|" "$APP_DIR/.env"
  echo "  .env creado con una contraseña aleatoria para la base de datos"
fi
cp "$SRC/.env.example" "$APP_DIR/.env.example"
cp "$SRC/scripts/actualizar.conf.example" "$APP_DIR/actualizar.conf.example"   # el ejemplo siempre al día
PORT="$(sed -n 's/^APP_PORT=//p' "$APP_DIR/.env" | tail -1)"; PORT="${PORT:-3002}"

# ---- 3. construir la imagen ----
cd "$SRC"
if [ -z "$SKIP_DOCKER" ]; then
  echo "▶ Construyendo $IMAGE (descarga la base actualizada; unos minutos)…"
  docker build --pull -q --build-arg "APP_VERSION=$VERSION" -t "$IMAGE" . >/dev/null

  # ---- 3b. copiar los datos de la instalación antigua de Contactos ----
  if [ "$MIGRAR" = s ]; then
    echo "▶ Copiando los datos de $OLD_DIR…"
    (cd "$OLD_DIR" && docker compose up -d db >/dev/null)
    for _ in $(seq 1 30); do (cd "$OLD_DIR" && docker compose exec -T db pg_isready -U contactos -d contactos >/dev/null 2>&1) && break; sleep 2; done
    DUMP="$BUILD/contactos.sql"
    (cd "$OLD_DIR" && docker compose exec -T db pg_dump -U contactos --no-owner --no-privileges contactos) > "$DUMP"
    [ -s "$DUMP" ] || fallo "No he podido sacar la copia de la base de datos de $OLD_DIR (no se ha tocado nada)."
    echo "  base de datos exportada ($(du -h "$DUMP" | cut -f1))"
    echo "  parando la instalación antigua (libera el puerto)…"
    (cd "$OLD_DIR" && docker compose down)
    mkdir -p "$APP_DIR/data/app"
    if [ -d "$OLD_DIR/data/app" ]; then cp -a "$OLD_DIR/data/app/." "$APP_DIR/data/app/"; echo "  fotos y copias locales copiadas"; fi
    (cd "$APP_DIR" && docker compose up -d db >/dev/null)
    for _ in $(seq 1 30); do (cd "$APP_DIR" && docker compose exec -T db pg_isready -U agendario -d agendario >/dev/null 2>&1) && break; sleep 2; done
    sleep 2
    (cd "$APP_DIR" && docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U agendario agendario) < "$DUMP" >/dev/null \
      || fallo "No he podido cargar los datos en la base nueva. La antigua sigue intacta: para volver, ejecuta  cd $OLD_DIR && docker compose up -d"
    echo "  base de datos cargada en Agendario"
  fi

  # ---- 4. recrear los contenedores ----
  echo "▶ Recreando Agendario…"
  (cd "$APP_DIR" && docker compose up -d --force-recreate --remove-orphans)

  echo "▶ Comprobando que responde en el puerto $PORT…"
  OK=n
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then OK=s; break; fi
    sleep 2
  done
  if [ "$OK" != s ]; then
    (cd "$APP_DIR" && docker compose logs --tail 40 app) || true
    PUB="$(cd "$APP_DIR" && docker compose port app 3002 2>/dev/null | sed 's/.*://')"
    [ -n "$PUB" ] && [ "$PUB" != "$PORT" ] && fallo "Docker publica la app en el puerto $PUB pero tu .env dice APP_PORT=$PORT. Revisa $APP_DIR/.env y $APP_DIR/docker-compose.yml (el zip se conserva)."
    [ -z "$PUB" ] && fallo "El contenedor no publica el puerto 3002 interno. Revisa la sección ports de $APP_DIR/docker-compose.yml (el zip se conserva)."
    fallo "No responde en http://127.0.0.1:$PORT/api/health. Mira los logs de arriba (el zip se conserva)."
  fi
  PUB="$(cd "$APP_DIR" && docker compose port app 3002 2>/dev/null | sed 's/.*://')"
  echo "  Puerto: $PORT (servidor) → 3002 (contenedor)$( [ -n "$PUB" ] && [ "$PUB" != "$PORT" ] && echo "  ⚠ Docker dice $PUB")"
  echo "  $(curl -fsS "http://127.0.0.1:$PORT/api/health")"
else
  echo "  (SKIP_DOCKER: sin construir ni recrear)"
fi

# ---- 5. subir a GitHub (si lo pediste) ----
if [ "$SUBIR" = s ]; then
  echo "▶ Subiendo a GitHub…"
  case "$VERSION" in *-*) RAMA=beta;; *) RAMA=main;; esac
  cd "$REPO"
  gh fetch -q origin 2>/dev/null || true
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" != "$RAMA" ]; then
    if git show-ref -q --verify "refs/heads/$RAMA"; then git checkout -q "$RAMA"
    elif git show-ref -q --verify "refs/remotes/origin/$RAMA"; then git checkout -q -b "$RAMA" "origin/$RAMA"
    else git checkout -q -b "$RAMA" 2>/dev/null || git checkout -q --orphan "$RAMA"; fi
  fi
  find "$REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -a "$SRC/." "$REPO/"
  git add -A
  if git diff --cached --quiet; then echo "  (no hay cambios respecto a lo ya subido: no hago commit)"; else git commit -q -m "Agendario $VERSION"; fi
  gh push -q -u origin "$RAMA"
  if [ -n "$OLD_TAG" ] && [ "$OLD_TAG" != "-" ]; then
    git tag -d "v$OLD_TAG" 2>/dev/null || true
    gh push -q origin --delete "v$OLD_TAG" 2>/dev/null || echo "  (la etiqueta v$OLD_TAG no estaba en GitHub)"
  fi
  git tag -f "v$VERSION" >/dev/null
  gh push -q -f origin "v$VERSION"
  URL="$(git remote get-url origin | sed -E 's#\.git$##; s#^git@github.com:#https://github.com/#; s#//[^/@]*@#//#')"
  echo "  Subido (rama $RAMA, etiqueta v$VERSION): $URL"
  echo "  GitHub Actions publicará la imagen en Docker Hub (pestaña Actions del repositorio)."
  case "$VERSION" in *-*) echo "  Recuerda: en GitHub crea la Release de v$VERSION y marca «Set as a pre-release».";; esac
fi

# ---- 6. limpieza ----
[ -z "$SKIP_DOCKER" ] && { docker image prune -f >/dev/null 2>&1 || true; }
rm -f "$ZIP"
rm -rf "$BUILD"

echo
if [ "$PRIMERA" = s ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "✓ Agendario $VERSION instalado. Entra en http://${IP:-IP_DEL_SERVIDOR}:$PORT y crea la cuenta de administrador.$( [ "$SUBIR" = s ] && echo " Subido a GitHub.") Zip borrado."
else
  echo "✓ Listo: Agendario está en la versión $VERSION.$( [ "$SUBIR" = s ] && echo " Subido a GitHub.") Zip borrado."
fi
[ -z "$SKIP_DOCKER" ] && { docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -Ei 'NAMES|agendario' || true; }
if [ "$MIGRAR" = s ]; then
  echo
  echo "ℹ Datos copiados desde $OLD_DIR. Entra en la web y comprueba que está todo."
  echo "  Cuando lo tengas claro, puedes borrar la instalación antigua:"
  echo "    rm -rf $OLD_DIR $BASE/actualizar-contactos.sh && docker image rm contactos-local"
fi
echo
echo "Si algo fallara, mira los logs:  (cd $APP_DIR && docker compose logs --tail 30)"

# ---- el script se actualiza a sí mismo con la versión que venía en el zip ----
# (mv sustituye el archivo sin tocar el que bash está leyendo ahora)
if [ -n "$NEW_SELF" ] && ! cmp -s "$NEW_SELF" "$SELF"; then
  chmod +x "$NEW_SELF" && mv -f "$NEW_SELF" "$SELF" && echo "(Este script se ha actualizado a la versión del zip.)"
fi
rm -f "$NEW_SELF" 2>/dev/null || true
