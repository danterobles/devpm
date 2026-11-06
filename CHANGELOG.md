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
