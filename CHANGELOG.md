# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

Categorías permitidas por versión: `Agregado`, `Cambiado`, `Obsoleto`, `Eliminado`, `Corregido`, `Seguridad`.

## [Sin publicar]

### Agregado
- Repositorio git inicializado en la rama `main` con `.gitignore` para Node.js y SQLite.
- `CHANGELOG.md` para registrar los cambios del proyecto.
- `CLAUDE.md` con stack (Node.js 22, Express 5, EJS, Tailwind CSS 4, SQLite/better-sqlite3),
  comandos, convenciones de código y flujo de trabajo (CHECKLIST → código → CHANGELOG → commit).
- `docs/PRD.md` con visión, roles, requerimientos funcionales (RF-01 a RF-95), 16 KPIs con
  fórmulas y umbrales, requerimientos no funcionales, criterios de aceptación del MVP y roadmap.
- `docs/ARQUITECTURA.md` con monolito modular por capas, decisiones (ADR-01 a ADR-08),
  estructura de carpetas, convenciones de API, tiempo real con SSE, diseño de Gantt y Burndown,
  seguridad, pruebas, mejores prácticas y despliegue.
- `docs/DATA.md` con convenciones de esquema, diagrama ER, 19 tablas (usuarios, clientes
  internos/externos, equipo, skills, ausencias, proyectos, hitos, asignaciones, sprints, tareas,
  dependencias, historial, registro de tiempo, snapshots de burndown, auditoría y soporte),
  índices, vistas para KPIs, ciclo de vida de datos y datos semilla.
- `CHECKLIST.md` con 12 etapas (0 a 11), tareas trazables a los requerimientos del PRD y
  criterio de cierre por etapa; Etapa 0 marcada como completada.

### Agregado (Etapa 1 — Scaffolding)
- `package.json` (ES Modules, Node >= 22) con scripts de desarrollo, build de CSS, pruebas y lint.
- Configuración validada con Zod (`src/config`), logger pino y `AppError`.
- App Express 5 (`createApp`) con helmet y CSP estricta, EJS con layout propio, `/health`,
  manejo central de errores (JSON en `/api`, vista HTML en el resto) y cierre ordenado.
- Tailwind CSS 4 (CSS-first), layout base con navegación y parciales de flash y paginación.
- `scripts/copy-vendor.js`: Chart.js y Frappe Gantt servidos localmente desde `public/vendor`.
- ESLint, Prettier y 11 pruebas iniciales (`node:test` + `supertest`).

### Cambiado
- `CLAUDE.md`: nueva regla para preguntar al usuario ante cualquier duda de definición y
  registrar la decisión en `docs/` antes de implementarla.
- `CLAUDE.md`: obligación de ejecutar la suite completa de pruebas y el lint al terminar cada
  tarea; si algo falla, corregir y volver a ejecutar antes de continuar o hacer commit.
