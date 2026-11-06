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
| 7 | Registro de tiempo | ⏳ Siguiente |
| 8 | Diagrama de Gantt | Pendiente |
| 9 | Burndown Chart | Pendiente |
| 10 | Tablero de KPIs en tiempo real | Pendiente |
| 11 | Calidad, seguridad y despliegue | Pendiente |

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
- [ ] Bandera facturable heredada y editable por el líder (RF-54)
- [ ] Exportación CSV (RF-55)
- [ ] Pruebas: límite diario de 24 h, fecha futura, aprobación por pm ajeno (403)

**Criterio de cierre:** criterio de aceptación PRD §8.3 (sin la parte de KPIs) cubierto por pruebas.

## Etapa 8 — Diagrama de Gantt

- [ ] Endpoint `GET /api/v1/projects/:id/gantt` (ARQUITECTURA §5)
- [ ] Vista con Frappe Gantt: tareas, hitos, dependencias, avance y vistas día/semana/mes (RF-70–RF-72)
- [ ] Reprogramación arrastrando, validando dependencias (RF-73)
- [ ] Gantt de portafolio (RF-74)
- [ ] Pruebas del formato de datos y de la validación de reprogramación

**Criterio de cierre:** el Gantt refleja las tareas del seed y permite reprogramar con validación.

## Etapa 9 — Burndown Chart

- [ ] Servicio de snapshots con upsert idempotente (DATA §3.14)
- [ ] Recalcular snapshot del día al cambiar tareas de un sprint activo (RF-81)
- [ ] Job diario y relleno de días faltantes al arrancar
- [ ] Endpoint `GET /api/v1/sprints/:id/burndown` con línea ideal en días hábiles (RF-80)
- [ ] Vista con Chart.js: real vs. ideal y cambios de alcance (RF-82)
- [ ] Burndown por horas (RF-83) y Burnup de proyecto (RF-84)
- [ ] Pruebas unitarias de línea ideal y de snapshots con fecha inyectada

**Criterio de cierre:** el burndown del sprint activo del seed es correcto día a día.

## Etapa 10 — Tablero de KPIs en tiempo real

- [ ] `realtime/eventBus.js` y emisión de eventos en todos los services (ARQUITECTURA §4)
- [ ] Endpoint SSE `/api/v1/events` con heartbeat, `retry` y limpieza al desconectar (RF-91)
- [ ] `kpi.service.js`: K1–K16 según PRD §6, con pruebas unitarias por fórmula
- [ ] Endpoint `GET /api/v1/dashboard/kpis` con filtros (RF-92)
- [ ] Vista del tablero: tarjetas con semáforo, gráficas y "Proyectos en riesgo" (RF-90, RF-93, RF-94)
- [ ] Cliente `public/js/lib/live.js` con debounce, indicador de conexión y última actualización (RF-95)
- [ ] Burndown, Kanban y Gantt escuchan eventos y se refrescan solos
- [ ] Umbrales configurables en `settings` (RF-93)
- [ ] Prueba de integración: cambio de tarea → evento SSE recibido
- [ ] Verificar PRD §8.4: con dos asignaciones traslapadas al 60 % del mismo miembro, K7 = 1

**Criterio de cierre:** criterios de aceptación PRD §8.2, §8.3 y §8.5 verificados.

## Etapa 11 — Calidad, seguridad y despliegue

- [ ] Revisión de seguridad (ARQUITECTURA §7): CSP, cookies, permisos por pertenencia
- [ ] Prueba de rendimiento con volumen de RNF-01 y revisión de `EXPLAIN QUERY PLAN`
- [ ] Cobertura ≥ 80 % en services (RNF-08)
- [ ] Revisión de accesibilidad y diseño responsivo (RNF-07)
- [ ] Script de respaldo `scripts/backup-db.js` con retención (RNF-09)
- [ ] `README.md` con instalación, uso y despliegue
- [ ] Recorrido completo de los criterios de aceptación del MVP (PRD §8)
- [ ] Publicar versión `0.1.0` en `CHANGELOG.md` y crear tag git `v0.1.0`

**Criterio de cierre:** MVP aceptado y etiquetado.
