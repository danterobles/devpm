# CLAUDE.md

Guía para Claude Code (y cualquier colaborador) al trabajar en este repositorio.

## Proyecto

**DevPM** — Sistema de gestión de proyectos de desarrollo de software. Administra clientes
internos y externos, equipo de desarrollo, proyectos, asignaciones, registro de tiempo y
planeación (sprints, tareas, hitos), con diagramas de Gantt, Burndown Charts y un tablero
de KPIs actualizado en tiempo real.

## Documentación (fuente de verdad)

Antes de implementar cualquier cosa, consulta los documentos correspondientes:

| Documento | Contenido |
|---|---|
| `docs/PRD.md` | Requerimientos funcionales y no funcionales, roles, KPIs y criterios de aceptación |
| `docs/ARQUITECTURA.md` | Arquitectura, estructura de carpetas, convenciones y mejores prácticas |
| `docs/DATA.md` | Entidades, atributos, relaciones, restricciones y consultas de KPIs |
| `CHECKLIST.md` | Tareas por etapa y su estado: **qué sigue** |
| `CHANGELOG.md` | Historial de cambios realizados |

Si una implementación contradice estos documentos, **actualiza primero el documento** (con su
commit) y después el código. Nunca dejes la documentación desfasada.

## Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Runtime | Node.js 22 LTS | ES Modules (`"type": "module"`) |
| Servidor HTTP | Express 5 | Manejo nativo de errores en handlers `async` |
| Vistas | EJS (SSR) | Layouts y parciales en `src/views/` |
| Estilos | Tailwind CSS 4 (`@tailwindcss/cli`) | Configuración CSS-first en `src/styles/input.css` |
| Base de datos | SQLite vía `better-sqlite3` | API síncrona, WAL, SQL plano con sentencias preparadas |
| Validación | Zod | Esquemas por módulo (`*.schemas.js`) |
| Gráficas | Chart.js (Burndown, KPIs) y Frappe Gantt | Servidas localmente desde `public/vendor/` |
| Tiempo real | Server-Sent Events (SSE) + `EventEmitter` | Sin dependencias extra |
| Autenticación | `express-session` + `bcrypt` | Sesiones persistidas en SQLite |
| Seguridad | `helmet`, `express-rate-limit` | CSP estricta, sin CDNs |
| Logs | `pino` (+ `pino-pretty` en desarrollo) | |
| Pruebas | `node:test` + `supertest` | SQLite en memoria por suite |
| Calidad | ESLint + Prettier | |

## Comandos

> Se habilitan a partir de la Etapa 1 del `CHECKLIST.md`.

```bash
npm install            # instala dependencias
npm run dev            # servidor con --watch + Tailwind en modo watch
npm run build:css      # compila Tailwind a public/css/output.css (minificado)
npm run db:migrate     # aplica migraciones pendientes de src/db/migrations/
npm run db:seed        # carga datos de ejemplo (solo desarrollo)
npm run db:reset       # elimina la BD local, migra y siembra
npm test               # ejecuta todas las pruebas
npm test -- --test-name-pattern="clients"   # ejecuta un subconjunto de pruebas
npm run test:coverage  # pruebas con reporte de cobertura
npm run lint           # ESLint
npm run format         # Prettier
npm start              # producción (requiere build:css previo)
```

## Estructura (resumen)

```
src/
  app.js              # fábrica de la app Express (sin listen, testeable)
  server.js           # arranque: listen, señales, cierre ordenado
  config/             # carga y validación de variables de entorno
  db/                 # conexión, migraciones, seeds
  modules/<modulo>/   # routes, controller, service, repository, schemas por dominio
  middlewares/        # auth, validate, errorHandler, notFound
  realtime/           # eventBus y endpoint SSE
  views/              # EJS: layouts/, partials/, pages/
  styles/input.css    # entrada de Tailwind
public/               # estáticos (css generado, js de páginas, vendor)
tests/                # pruebas de integración y unitarias
data/                 # archivo SQLite local (ignorado por git)
```

Detalle completo en `docs/ARQUITECTURA.md`.

## Convenciones de código

- **Idioma:** identificadores, tablas, columnas y rutas de API en **inglés**; textos de UI,
  documentación, mensajes de commit y CHANGELOG en **español**.
- **Nombres:** `camelCase` en JS, `snake_case` en SQL, `kebab-case` en archivos y rutas URL.
- **Capas:** `routes → controller → service → repository → db`. Los controllers no tocan SQL;
  los repositories no contienen reglas de negocio.
- **SQL:** siempre sentencias preparadas con parámetros. Prohibido concatenar entrada del usuario.
- **Escrituras múltiples:** dentro de `db.transaction(...)`.
- **Fechas:** `TEXT` ISO-8601 (`YYYY-MM-DD` para fechas, UTC `YYYY-MM-DDTHH:mm:ss.sssZ` para marcas de tiempo).
- **Duraciones:** minutos como `INTEGER` (nunca horas flotantes). **Dinero:** centavos como `INTEGER`.
- **Validación:** toda entrada externa pasa por un esquema Zod antes del service.
- **Errores:** lanza `AppError` (con `status` y `code`); el `errorHandler` central da formato.
- **Eventos:** todo service que modifica datos que alimentan KPIs emite un evento en `eventBus`
  **después** de confirmar la transacción.
- **Vistas:** usa `<%= %>` (escapado). `<%- %>` solo para parciales propios.
- **Sin dependencias nuevas** sin justificarlas en `docs/ARQUITECTURA.md`.

## Flujo de trabajo obligatorio

1. **Consulta `CHECKLIST.md`** para identificar la siguiente tarea pendiente de la etapa activa.
2. Lee la sección relevante de `docs/` antes de escribir código.
3. Implementa el cambio con sus pruebas (las pruebas deben pasar: `npm test`).
4. **Actualiza `CHECKLIST.md`**: marca `[x]` lo completado y agrega tareas descubiertas.
5. **Actualiza `CHANGELOG.md`** en la sección `[Sin publicar]` con la categoría adecuada.
6. **Haz un commit por cambio lógico** con mensaje descriptivo (ver abajo). Un commit no debe
   mezclar funcionalidades no relacionadas.

### Mensajes de commit

Formato [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/), en español:

```
<tipo>(<ámbito opcional>): <resumen en imperativo, ≤ 72 caracteres>

- Detalle de qué cambió y por qué.
- Referencia a requerimiento cuando aplique (p. ej. RF-05).
```

Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `build`.
Ejemplos: `feat(clients): agrega CRUD de clientes externos`,
`docs(data): define entidad time_entries`.

## Reglas importantes

- No subir `.env`, archivos `.db` ni `public/css/output.css` (ya están en `.gitignore`).
- Las migraciones aplicadas **nunca se editan**: crea una nueva migración numerada.
- Al cerrar una etapa del CHECKLIST, ejecuta `npm test` y `npm run lint` antes del commit final.
- Los KPIs se calculan en `src/modules/dashboard/` y sus fórmulas deben coincidir con `docs/PRD.md`.
