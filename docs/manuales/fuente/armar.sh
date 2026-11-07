#!/bin/sh
# Prepara los guiones de captura de los manuales (ver README.md de esta carpeta).
# Uso, desde la raíz del proyecto:  sh docs/manuales/fuente/armar.sh
set -e
ROOT="$(pwd)"
SRC="$ROOT/docs/manuales/fuente"
mkdir -p "$ROOT/.playwright-mcp/shots"
for kind in user admin; do
  { echo "async (page) => {"; sed "s#__ROOT__#$ROOT#g" "$SRC/lib.js"; cat "$SRC/$kind-body.js"; echo "}"; } > "$ROOT/.playwright-mcp/$kind-shots.js"
done
sed "s#__ROOT__#$ROOT#g" "$SRC/imprimir.js" > "$ROOT/.playwright-mcp/imprimir.js"
echo "Listo: .playwright-mcp/user-shots.js, admin-shots.js e imprimir.js"
