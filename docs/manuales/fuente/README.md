# Fuentes de los manuales

Los manuales en PDF (`../Manual-Usuario.pdf` y `../Manual-Administrador.pdf`) se generan con estos archivos para poder
rehacerlos cuando cambie la interfaz (RF-183). No añaden dependencias al proyecto: usan un navegador controlado con
Playwright (por ejemplo el servidor MCP de Playwright de Claude Code, o `npx playwright`) y Python 3 para armar el HTML.

| Archivo | Qué es |
|---|---|
| `lib.js` | Ayudantes: iniciar sesión, marcar elementos con círculos numerados y capturar |
| `user-body.js` / `admin-body.js` | Guiones de capturas de cada manual (los números coinciden con los pasos del texto) |
| `build.py` | Textos de los manuales (Python, sin dependencias): lee las capturas y escribe los dos HTML |
| `armar.sh` | Junta `lib.js` y los guiones en `.playwright-mcp/` y prepara la impresión |
| `imprimir.js` | Imprime los HTML a PDF (carta horizontal, con márgenes y número de página) |

## Pasos

1. Levanta una copia con los datos de ejemplo y correo «configurado» (para que se vea el formulario de recuperación):

   ```bash
   export DATABASE_PATH=/tmp/manual.db UPLOAD_DIR=/tmp/manual-uploads PORT=3456 \
          SESSION_SECRET=$(node -e "console.log('x'.repeat(40))") SMTP_HOST=127.0.0.1 SMTP_PORT=2525
   rm -rf /tmp/manual.db* /tmp/manual-uploads && npm run db:reset && node src/server.js
   ```

2. En otra terminal, desde la raíz del proyecto: `sh docs/manuales/fuente/armar.sh`.
3. Ejecuta en el navegador `.playwright-mcp/user-shots.js` y después `.playwright-mcp/admin-shots.js` (cada archivo es una
   función `async (page) => {…}` que devuelve el registro de capturas; no debe haber «marcas no encontradas» ni errores).
4. Arma los HTML: `cd .playwright-mcp && python3 ../docs/manuales/fuente/build.py`.
5. Sirve la carpeta (`python3 -m http.server 8765 --directory .playwright-mcp`) y ejecuta `.playwright-mcp/imprimir.js`.
6. Revisa los PDF (páginas, márgenes, números) y borra `.playwright-mcp/` (ESLint la revisaría).

Al agregar una pantalla: súmale su captura en el guion y su sección en `build.py` (la numeración es automática).
