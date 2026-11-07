# CHECKLIST — DevPM

Control de avance por etapas. **Consúltalo antes de empezar cualquier trabajo y actualízalo al
terminar cada tarea** (ver flujo en `CLAUDE.md`).

- `[ ]` pendiente · `[~]` en progreso · `[x]` completada
- Entre paréntesis: requerimiento del PRD que cubre la tarea.
- Cada etapa termina con su **criterio de cierre**; no se avanza a la siguiente sin cumplirlo.
- Tareas descubiertas durante el trabajo se agregan a la etapa correspondiente.

## Resumen

| Etapa | Nombre | Estado |
|---|---|---|
| 0 | Documentación y repositorio | ✅ Completada |
| 1 | Scaffolding del proyecto | ✅ Completada |
| 2 | Base de datos | ✅ Completada |
| 3 | Autenticación y roles | ✅ Completada |
| 4 | Clientes y equipo | ✅ Completada |
| 5 | Proyectos, hitos y asignaciones | ✅ Completada |
| 6 | Planeación: sprints y tareas | ✅ Completada |
| 7 | Registro de tiempo | ✅ Completada |
| 8 | Diagrama de Gantt | ✅ Completada |
| 9 | Burndown Chart | ✅ Completada |
| 10 | Tablero de KPIs en tiempo real | ✅ Completada |
| 11 | Calidad, seguridad y despliegue | ✅ Completada |
| 12 | Rediseño visual (diseño D) | ✅ Completada |
| 13 | Gantt en modo oscuro | ✅ Completada |
| 14 | Endurecimiento de seguridad | ✅ Completada |
| 15 | Notificaciones (app y correo) | ✅ Completada |
| 16 | Mi día (panel por rol) | ✅ Completada |
| 17 | Importación por CSV | ✅ Completada |
| 18 | Comentarios y menciones (v0.4) | ✅ Completada |
| 19 | Adjuntos (v0.4) | ✅ Completada |
| 20 | Búsqueda global y filtros guardados (v0.4) | 🔄 En curso |
| 21 | Manuales y versión 0.4.0 | ⏳ Planeada |

---

## Etapa 0 — Documentación y repositorio

- [x] Inicializar repositorio git en rama `main` con `.gitignore`
- [x] Crear `CHANGELOG.md` (formato Keep a Changelog)
- [x] Crear `CLAUDE.md` con stack, comandos, convenciones y flujo de trabajo
- [x] Crear `docs/PRD.md` con requerimientos, KPIs y criterios de aceptación
- [x] Crear `docs/ARQUITECTURA.md` con arquitectura y mejores prácticas
- [x] Crear `docs/DATA.md` con entidades, relaciones, índices y vistas
- [x] Crear `CHECKLIST.md` por etapas

**Criterio de cierre:** documentos base versionados, cada uno en su propio commit. ✅

## Etapa 1 — Scaffolding del proyecto

- [x] `package.json` con `"type": "module"`, `engines.node >= 22` y scripts de `CLAUDE.md`
- [x] Instalar dependencias de producción y desarrollo (ARQUITECTURA §11)
- [x] `.env.example` y `src/config/index.js` con validación Zod
- [x] `src/lib/logger.js` (pino) y `src/lib/AppError.js`
- [x] `src/app.js` (`createApp({ db })`) con helmet, parsers, estáticos y EJS
- [x] `src/server.js` con cierre ordenado (SIGINT/SIGTERM)
- [x] Middlewares `notFound` y `errorHandler` (JSON en `/api/*`, vista en HTML)
- [x] Endpoint `GET /health`
- [x] Tailwind CSS 4: `src/styles/input.css` con `@theme`, scripts `build:css` y modo watch
- [x] `scripts/copy-vendor.js` (Chart.js y Frappe Gantt → `public/vendor/`) en `postinstall`
- [x] Layout base `views/layouts/main.ejs` con navegación y parciales (flash, paginación)
- [x] ESLint + Prettier configurados (`npm run lint`, `npm run format`)
- [x] Infraestructura de pruebas: `node:test`, `supertest`, prueba de `/health`

**Criterio de cierre:** `npm run dev` levanta el servidor con estilos; `npm test` y `npm run lint` pasan. ✅

## Etapa 2 — Base de datos

- [x] `src/db/connection.js` con PRAGMAs (WAL, foreign_keys, busy_timeout, synchronous)
- [x] Runner de migraciones `src/db/migrate.js` con tabla `schema_migrations`
- [x] Migración `001_init.sql`: todas las tablas de `docs/DATA.md` §3
- [x] Migración `002_indexes_views.sql`: índices (§4) y vistas de KPIs (§5)
- [x] Helper de pruebas `tests/helpers/testDb.js` (BD `:memory:` migrada) y `factories.js`
- [x] Pruebas de restricciones clave (CHECK de clientes, un sprint activo, FK)
- [x] Seed de desarrollo `src/db/seeds/dev.js` (DATA §7) y script `db:reset`
- [x] Utilidad de auditoría (`audit_log`) reutilizable por los services

**Criterio de cierre:** `npm run db:reset` crea la BD con datos de ejemplo; pruebas de esquema pasan. ✅

## Etapa 3 — Autenticación y roles

- [x] Sesiones con `express-session` y store propio en SQLite; cookie segura (RNF-04)
- [x] Login / logout con bcrypt y `session.regenerate()` (RF-01)
- [x] Rate limit en `/login` (RNF-04)
- [x] Middlewares `requireAuth` y `requireRole` (RF-02)
- [x] Verificación de `Origin` en métodos que modifican estado (CSRF)
- [x] CRUD de usuarios para `admin` y vinculación con miembro del equipo (RF-03, RF-04)
- [x] Cambio de contraseña propio (RF-05)
- [x] Pruebas: login correcto/incorrecto, 401 sin sesión, 403 por rol

**Criterio de cierre:** criterio de aceptación PRD §8.6 cubierto por pruebas. ✅

## Etapa 4 — Clientes y equipo

- [x] Módulo `clients`: repository, service, schemas Zod por tipo, rutas API
- [x] Vistas de clientes internos: listado con búsqueda/filtro/paginación y formulario (RF-10, RF-11)
- [x] Vistas de clientes externos: listado y formulario con tarifa y moneda (RF-15, RF-16)
- [x] Regla: no eliminar cliente con proyectos, solo desactivar (RF-18)
- [x] Módulo `team`: CRUD de miembros (RF-20)
- [x] Skills y nivel por miembro (RF-21)
- [x] Ausencias (RF-22)
- [x] Pruebas de integración de clientes y equipo

**Criterio de cierre:** CRUD completo de clientes (ambos tipos) y equipo, con pruebas en verde. ✅

## Etapa 5 — Proyectos, hitos y asignaciones

- [x] Módulo `projects`: CRUD con código único y `is_billable` según tipo de cliente (RF-30, RF-34)
- [x] Transiciones de estado válidas (RF-31, DATA §3.6)
- [x] Hitos por proyecto (RF-32)
- [x] Ficha del proyecto (resumen, equipo, hitos) (RF-33); enlaces a Gantt y Burndown pendientes de las Etapas 8 y 9
- [x] Módulo `assignments` con validación de periodo dentro del proyecto (RF-40)
- [x] Advertencia de sobreasignación > 100 % (RF-41)
- [x] Vista de carga del equipo por semana (RF-23) y matriz de asignaciones (RF-43)
- [x] Fichas de cliente con proyectos y horas (RF-12, RF-17)
- [x] Pruebas: transiciones inválidas (422), sobreasignación, permisos

**Criterio de cierre:** criterio de aceptación PRD §8.4 cubierto por pruebas (alerta de sobreasignación 60 % + 60 %); la parte «K7 = 1» se verifica en la Etapa 10. ✅

## Etapa 6 — Planeación: sprints y tareas

- [x] Sprints: CRUD, iniciar (fija `committed_points`) y cerrar; un solo activo (RF-60, RF-66)
- [x] Tareas: CRUD con story points, estimación, fechas, responsable asignado al proyecto (RF-61, RF-42)
- [x] Historial de estados y `started_at`/`completed_at` (RF-62)
- [x] Backlog del proyecto con ordenamiento (RF-63)
- [x] Tablero Kanban por sprint con arrastrar y soltar (RF-63)
- [x] Dependencias fin-a-inicio con detección de ciclos (RF-64)
- [x] Subtareas (RF-65)
- [x] Pruebas: ciclo de dependencias, cierre de sprint, responsable no asignado

**Criterio de cierre:** un sprint se planea, ejecuta en Kanban y cierra correctamente. ✅

## Etapa 7 — Registro de tiempo

- [x] Módulo `time-entries`: CRUD con validaciones RF-53 y asignación vigente
- [x] Hoja de tiempos semanal (cuadrícula día × proyecto) (RF-51)
- [x] Flujo de envío y aprobación/rechazo por el líder del proyecto (RF-52)
- [x] Bandera facturable heredada y editable por el líder (RF-54)
- [x] Exportación CSV (RF-55)
- [x] Pruebas: límite diario de 24 h, fecha futura, aprobación por pm ajeno (403)

**Criterio de cierre:** criterio de aceptación PRD §8.3 (sin la parte de KPIs) cubierto por pruebas. ✅

## Etapa 8 — Diagrama de Gantt

- [x] Endpoint `GET /api/v1/projects/:id/gantt` (ARQUITECTURA §5)
- [x] Vista con Frappe Gantt: tareas, hitos, dependencias, avance y vistas día/semana/mes (RF-70–RF-72)
- [x] Reprogramación arrastrando, validando dependencias (RF-73)
- [x] Gantt de portafolio (RF-74)
- [x] Pruebas del formato de datos y de la validación de reprogramación

**Criterio de cierre:** el Gantt refleja las tareas del seed y permite reprogramar con validación. ✅

## Etapa 9 — Burndown Chart

- [x] Servicio de snapshots con upsert idempotente (DATA §3.14)
- [x] Recalcular snapshot del día al cambiar tareas de un sprint activo (RF-81)
- [x] Job diario y relleno de días faltantes al arrancar
- [x] Endpoint `GET /api/v1/sprints/:id/burndown` con línea ideal en días hábiles (RF-80)
- [x] Vista con Chart.js: real vs. ideal y cambios de alcance (RF-82)
- [x] Burndown por horas (RF-83) y Burnup de proyecto (RF-84)
- [x] Pruebas unitarias de línea ideal y de snapshots con fecha inyectada

**Criterio de cierre:** el burndown del sprint activo del seed es correcto día a día. ✅

## Etapa 10 — Tablero de KPIs en tiempo real

- [x] `realtime/eventBus.js` y emisión de eventos en todos los services (ARQUITECTURA §4)
- [x] Endpoint SSE `/api/v1/events` con heartbeat, `retry` y limpieza al desconectar (RF-91)
- [x] `kpi.service.js`: K1–K16 según PRD §6, con pruebas unitarias por fórmula
- [x] Endpoint `GET /api/v1/dashboard/kpis` con filtros (RF-92)
- [x] Vista del tablero: tarjetas con semáforo, gráficas y "Proyectos en riesgo" (RF-90, RF-93, RF-94)
- [x] Cliente `public/js/lib/live.js` con debounce, indicador de conexión y última actualización (RF-95)
- [x] Burndown, Kanban y Gantt escuchan eventos y se refrescan solos
- [x] Umbrales configurables en `settings` (RF-93)
- [x] Prueba de integración: cambio de tarea → evento SSE recibido
- [x] Verificar PRD §8.3 (parte de KPIs): al aprobar las horas del developer, K4, K6 y K13 cambian
- [x] Verificar PRD §8.4: con dos asignaciones traslapadas al 60 % del mismo miembro, K7 = 1

**Criterio de cierre:** criterios de aceptación PRD §8.2, §8.3 y §8.5 verificados. ✅

## Etapa 11 — Calidad, seguridad y despliegue

- [x] Revisión de seguridad (ARQUITECTURA §7): CSP, cookies, permisos por pertenencia
- [x] Prueba de rendimiento con volumen de RNF-01 y revisión de `EXPLAIN QUERY PLAN`
- [x] Cobertura ≥ 80 % en services (RNF-08)
- [x] Revisión de accesibilidad y diseño responsivo (RNF-07)
- [x] Script de respaldo `scripts/backup-db.js` con retención (RNF-09)
- [x] Alta del primer administrador en producción: `npm run user:create` (descubierta: el seed solo existe en desarrollo)
- [x] `postinstall` que compila el CSS para que `npm install && npm run db:migrate && npm start` funcione (RNF-10)
- [x] `README.md` con instalación, uso y despliegue
- [x] Recorrido completo de los criterios de aceptación del MVP (PRD §8)
- [x] Publicar versión `0.1.0` en `CHANGELOG.md` y crear tag git `v0.1.0`

**Criterio de cierre:** MVP aceptado y etiquetado. ✅ (`v0.1.0`)

## Etapa 12 — Rediseño visual (diseño D «Dashboard Enfoque», RNF-12)

- [x] Paleta `navy`, variante `dark:` y redefinición de tokens para el modo oscuro en `input.css`
- [x] `public/js/lib/theme.js` y selector Sistema / Claro / Oscuro con persistencia en el navegador
- [x] Layout nuevo: riel de iconos, encabezado azul marino y navegación con `aria-current`
- [x] Tablero: tarjetas de KPI con barra de semáforo, filtros y paneles al estilo D
- [x] Gráficas (Chart.js) con colores según el tema
- [x] Revisión de contraste AA en claro y oscuro y de 360 px sin desbordes

**Criterio de cierre:** todas las pantallas se ven bien en ambos temas, `npm test` y `npm run lint` en verde. ✅

## Etapa 13 — Gantt en modo oscuro (RNF-12)

- [x] Variables `--g-*` del Gantt con la paleta `navy` bajo la variante `dark:` en `input.css` (proyecto y portafolio)
- [x] Pruebas de contraste AA de los textos del Gantt en oscuro y de que `input.css` define las variables
- [x] Verificación en el navegador (claro, oscuro y 360 px) del Gantt de proyecto y del de portafolio
- [x] Captura del Gantt en el manual: sin cambios (el manual usa el tema claro, que no varía)

**Criterio de cierre:** el Gantt se ve integrado en ambos temas, `npm test` y `npm run lint` en verde. ✅

## Etapa 14 — Endurecimiento de seguridad (revisión de la v0.2.1)

- [x] Registro en el log de inicios de sesión fallidos y bloqueos (`login.failed`, `login.blocked`)
- [x] Límite de intentos también por cuenta (el doble que por IP)
- [x] Contraseñas: máximo de 72 bytes UTF-8 con mensaje claro
- [x] `Sec-Fetch-Site: cross-site` rechazado en métodos que modifican datos
- [x] ID de sesión con hash SHA-256 en la tabla `sessions`
- [x] Respaldos con permisos `0600` y carpeta `0700`
- [x] Documentar riesgos aceptados (ARQUITECTURA §7.1) y la nota de actualización en README y CHANGELOG

**Criterio de cierre:** pruebas de cada control, `npm test` y `npm run lint` en verde. ✅

## Etapa 15 — Notificaciones (v0.3, RF-100–RF-104)

- [x] Migración `005_notifications.sql`: tabla `notifications` y `users.email_notifications`
- [x] Config: `APP_URL` y `SMTP_*` opcionales; `lib/mailer.js` con `nodemailer` (deshabilitado sin SMTP)
- [x] Módulo `notifications`: repository, service (`notify` con deduplicación, listar, leer, `prune`) y API
- [x] Página `/notifications` y campana con contador en el encabezado (en vivo por SSE)
- [x] Preferencia de correo en `/account/notifications`
- [x] Avisos por evento: horas por aprobar, aprobadas/rechazadas, tarea asignada, tarea bloqueada
- [x] Job diario 09:00 y al arrancar: recordatorios de horas, tareas y hitos vencidos, proyectos en riesgo
- [x] Pruebas por tipo de aviso, deduplicación, correo (`jsonTransport`) y permisos
- [x] Documentar `SMTP_*` y `APP_URL` en README y `.env.example`

**Criterio de cierre:** cada aviso de PRD §5.12.1 llega a su destinatario, sin duplicados, `npm test` y `npm run lint` en verde. ✅

## Etapa 16 — Mi día (v0.3, RF-110–RF-114)

- [x] Service y repository de solo lectura del panel por rol
- [x] Vista de inicio para `developer`, `pm`/`admin` y `viewer`, con notificaciones sin leer
- [x] Actualización en vivo con `live.js`
- [x] Pruebas por rol (contenido y permisos)

**Criterio de cierre:** cada rol ve en su inicio lo que necesita para empezar el día.  ✅

## Etapa 17 — Importación por CSV (v0.3, RF-120–RF-123)

- [x] `lib/csv.js`: lectura (comillas, saltos de línea, separador `,` o `;`, BOM) con pruebas
- [x] Esquemas por entidad (clientes, miembros, tareas) que reutilizan los de cada módulo
- [x] Service: validar fila por fila, detectar duplicados e importar todo-o-nada con eventos tras el commit
- [x] Vista `/import`: entidad, archivo o texto pegado, vista previa con errores, plantilla descargable
- [x] Pruebas: errores por fila, duplicados, límites, permisos, bitácora y eventos

**Criterio de cierre:** un CSV válido crea todos sus registros; uno con errores no crea ninguno.  ✅

---

# Versión 0.4.0 — Colaboración (plan aprobado el 7 nov 2026)

Orden recomendado: 18 → 19 → 20 → 21. Cada etapa se cierra con `npm test` y `npm run lint` en verde y un commit por cambio lógico. Las propuestas de PRD §5.17 fueron aprobadas.

## Etapa 18 — Comentarios y menciones (RF-130–RF-134)

- [x] Migración `006_collaboration.sql`: `task_comments`, `task_attachments` y `saved_filters` con sus índices (una sola migración para la v0.4)
- [x] Módulo `comments`: repository, service con permisos (RF-131, RF-132) y bitácora, schemas Zod y API
- [x] Menciones por correo completo y avisos al responsable y al líder con el notificador (RF-133); tipo de aviso `task_comment`/`task_mention` en PRD §5.12.1 y DATA §3.16
- [x] Conversación en la ficha de la tarea (formulario, editar, eliminar) escapada y accesible
- [x] Actualización en vivo: evento `comment.changed` en `live.js` y en la ficha (RF-134)
- [x] Pruebas: permisos por rol y por proyecto, edición/baja propia y de admin, menciones, XSS, avisos sin autoavisar, evento

**Criterio de cierre:** una conversación completa en una tarea, con avisos a quien corresponde y sin fugas de permisos. ✅

## Etapa 19 — Adjuntos (RF-140–RF-144)

- [x] Config `UPLOAD_DIR` y `UPLOAD_MAX_MB`; carpeta con permisos `0700` y archivos `0600`; ignorada por git
- [x] Módulo `attachments`: límites (5 MB, 10 por tarea), lista de tipos y verificación de firma (RF-140, RF-143)
- [x] Subida con `express.raw` y `fetch`; descarga autenticada siempre como `attachment` con `nosniff` (RF-142)
- [x] Baja del archivo y de su registro en una sola operación (sin archivos huérfanos); limpieza al eliminar la tarea
- [x] Interfaz en la ficha de la tarea (lista, subir, descargar, eliminar) con avisos de error claros
- [x] `db:backup` incluye la carpeta de adjuntos y la restauración está documentada (RF-144)
- [x] Pruebas: tipos permitidos y rechazados (HTML, SVG, ejecutable, extensión falsa), tamaño, permisos, ruta no manipulable (`../`), nombre con caracteres especiales, descarga forzada
- [x] Revisión de seguridad de la etapa (ARQUITECTURA §7) y documentar el riesgo de no tener antivirus

**Criterio de cierre:** se adjunta, descarga y elimina un archivo sin que pueda ejecutarse en el navegador ni salir de `UPLOAD_DIR`. ✅

## Etapa 20 — Búsqueda global y filtros guardados (RF-150–RF-153)

- [ ] Backlog con filtros (texto, tipo, prioridad, responsable) y formulario de la exportación que acepte `?from=&to=&status=` (base de los filtros guardados)
- [ ] Módulo `search`: consultas de solo lectura por grupo con `LIKE` escapado y permisos (RF-150, RF-151)
- [ ] Caja de búsqueda en el encabezado y página `/search` con grupos y «ver más»
- [ ] Prueba de rendimiento de la búsqueda con el volumen de RNF-01 (`npm run test:perf`) y decisión sobre FTS5 (RF-153)
- [ ] Módulo de filtros guardados: API y selector en los listados de proyectos, backlog y tiempo; máximo 20 por usuario (RF-152)
- [ ] Pruebas: permisos de los resultados, escape de la consulta, límites, filtros ajenos inaccesibles

**Criterio de cierre:** se encuentra cualquier proyecto, tarea, cliente o miembro por texto, sin ver más de lo permitido.

## Etapa 21 — Manuales y versión 0.4.0

- [ ] Actualizar los manuales en PDF con lo de las versiones 0.3 y 0.4: notificaciones, «Mi día», importación, comentarios, adjuntos, búsqueda y filtros guardados (usuario y administrador, `SMTP_*` y `UPLOAD_DIR`)
- [ ] README: nuevas variables, restauración de adjuntos y guía de actualización
- [ ] Recorrido de aceptación de la v0.4 (comentar con mención → aviso; adjuntar y descargar; buscar y guardar un filtro) y revisión de seguridad completa
- [ ] CHANGELOG `[0.4.0]`, versión en `package.json`, etiqueta `v0.4.0` y publicación

**Criterio de cierre:** 0.4.0 aceptada y etiquetada.
