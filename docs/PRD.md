# PRD — DevPM: Gestión de Proyectos de Desarrollo de Software

| Campo | Valor |
|---|---|
| Versión | 0.1 (borrador inicial) |
| Fecha | 2026-11-06 |
| Estado | En definición |
| Documentos relacionados | `docs/ARQUITECTURA.md`, `docs/DATA.md`, `CHECKLIST.md` |

---

## 1. Visión

Contar con una herramienta web única para planear, ejecutar y controlar proyectos de desarrollo
de software, que permita a la dirección y a los líderes de proyecto **ver en tiempo real** el
estado del portafolio (avance, cumplimiento de calendario, consumo de horas y carga del equipo)
y tomar decisiones antes de que los problemas se materialicen.

## 2. Problema

- La información de proyectos, asignaciones y horas está dispersa (hojas de cálculo, chats, correo).
- No hay visibilidad de la carga real de cada desarrollador: hay sobreasignaciones y tiempo ocioso.
- Los retrasos se detectan tarde porque no se compara lo planeado contra lo real.
- No se distingue con claridad el esfuerzo dedicado a clientes internos (no facturable) del
  dedicado a clientes externos (facturable).

## 3. Objetivos

| # | Objetivo | Indicador de éxito |
|---|---|---|
| O1 | Centralizar clientes, equipo, proyectos y planeación | 100 % de proyectos activos registrados en el sistema |
| O2 | Controlar la capacidad del equipo | 0 desarrolladores con asignación > 100 % sin alerta visible |
| O3 | Detectar desviaciones temprano | Proyectos en riesgo identificados automáticamente (SPI < 0.9) |
| O4 | Tablero de KPIs en tiempo real | Cambios reflejados en el tablero en ≤ 2 s sin recargar la página |
| O5 | Registrar el tiempo real invertido | ≥ 95 % de horas de la semana registradas y aprobadas |

## 4. Usuarios y roles

| Rol | Descripción | Permisos principales |
|---|---|---|
| **Administrador** (`admin`) | Responsable de la plataforma | Todo, incluida la gestión de usuarios y catálogos |
| **Líder de proyecto** (`pm`) | Planea y controla proyectos | CRUD de proyectos, sprints, tareas, asignaciones; aprueba horas de sus proyectos; ve KPIs |
| **Desarrollador** (`developer`) | Ejecuta tareas | Ve sus asignaciones y tareas, cambia estado de sus tareas, registra su tiempo |
| **Observador** (`viewer`) | Dirección o cliente interno | Solo lectura de proyectos, Gantt, Burndown y tablero |

## 5. Alcance funcional

Cada requerimiento funcional (RF) tiene un identificador para referenciarlo en commits y en el CHECKLIST.
Prioridad: **Alta** = MVP, **Media** = siguiente iteración, **Baja** = deseable.

### 5.1 Autenticación y usuarios

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-01 | Inicio y cierre de sesión con correo y contraseña. | Alta |
| RF-02 | Control de acceso por rol en vistas y endpoints (ver §4). | Alta |
| RF-03 | El administrador crea, edita, desactiva usuarios y les asigna rol. | Alta |
| RF-04 | Un usuario puede vincularse a un miembro del equipo (para registrar su propio tiempo). | Alta |
| RF-05 | Cambio de contraseña por el propio usuario. | Media |

**Decisiones de definición (RF-03 a RF-05):**

- El admin captura la contraseña inicial al crear el usuario (y puede restablecerla al editar);
  no hay cambio forzado en el primer inicio de sesión.
- Política de contraseña (alta, edición y RF-05): mínimo 8 y máximo 200 caracteres, sin reglas de composición.
- Los usuarios **no se eliminan**: solo se desactivan (`is_active = 0`). Desactivar a un usuario,
  cambiarle el rol o la contraseña cierra todas sus sesiones.
- Un admin no puede desactivarse a sí mismo ni quitarse el rol `admin`.
- La vinculación (RF-04) es opcional y acepta el `team_member_id` de un miembro existente; un
  miembro solo puede estar vinculado a un usuario. El CRUD de miembros llega en la Etapa 4.
- RF-05: el usuario cambia su contraseña indicando la actual (y confirmando la nueva en la vista);
  la nueva debe ser distinta de la actual. Se cierran sus demás sesiones y se conserva la actual.
  Disponible para cualquier rol en `/account/password` y `PATCH /api/v1/me/password`.
- Se ofrece API JSON (`/api/v1/users`) y vistas de administración (`/admin/users`), solo para `admin`.

### 5.2 Clientes internos

Áreas o departamentos de la propia organización que solicitan desarrollos (no facturables).

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-10 | CRUD de clientes internos: nombre, departamento, centro de costos, responsable y contacto. | Alta |
| RF-11 | Listado con búsqueda, filtro por estado (activo/inactivo) y paginación. | Alta |
| RF-12 | Ficha del cliente con sus proyectos y horas consumidas. | Media |

### 5.3 Clientes externos

Empresas con relación comercial; su trabajo es facturable.

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-15 | CRUD de clientes externos: razón social, nombre comercial, RFC/ID fiscal, contacto, tarifa por hora y moneda. | Alta |
| RF-16 | Listado con búsqueda, filtros y paginación. | Alta |
| RF-17 | Ficha del cliente con proyectos, horas facturables y monto estimado (horas × tarifa). | Media |
| RF-18 | No se permite eliminar un cliente con proyectos; solo desactivarlo. | Alta |

**Decisiones de definición (clientes, RF-10 a RF-18):**

- Permisos: cualquier usuario autenticado puede **leer** clientes; solo `admin` y `pm` pueden crear
  y editar (403 para `developer` y `viewer`).
- API: un solo recurso `/api/v1/clients` con discriminador `type` (`internal` | `external`); el
  esquema de validación depende del tipo y el `type` no se puede cambiar después de crear.
  El listado admite `?type=`, `?status=`, `?q=` y paginación.
- La tarifa viaja como `hourlyRateCents` (centavos) y la moneda como código de 3 letras mayúsculas
  (formato ISO-4217, sin catálogo cerrado).

### 5.4 Equipo de desarrollo

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-20 | CRUD de miembros: nombre, correo, puesto (frontend, backend, fullstack, QA, DevOps, diseño, PM), seniority, capacidad semanal en horas y costo por hora. | Alta |
| RF-21 | Registro de habilidades (skills) con nivel 1–5 por miembro. | Media |
| RF-22 | Registro de ausencias (vacaciones, incapacidad, permiso) que reducen la capacidad. | Media |
| RF-23 | Vista de carga: asignación % por miembro y semana, con alerta si supera 100 %. | Alta |

**Decisiones de definición (equipo, RF-20 a RF-22):**

- Permisos: cualquier usuario autenticado **lee** la lista y la ficha de miembros; solo `admin` y `pm`
  crean y editan miembros, habilidades y ausencias.
- El costo por hora (`hourlyCostCents`) solo lo ven `admin` y `pm`; para `developer` y `viewer` el
  campo se omite en API y vistas.
- Habilidades: no hay catálogo aparte; al asignar una habilidad por nombre (nivel 1–5) a un miembro se
  crea en el catálogo si no existe (sin distinguir mayúsculas); la categoría es opcional.
- Los miembros y los clientes **no se eliminan**: solo se desactivan (`is_active = 0`) (RF-18). Las
  ausencias sí se pueden eliminar.
- Hay API JSON y vistas EJS para clientes internos, externos y equipo (habilidades y ausencias se
  gestionan en la ficha del miembro). En las vistas los controles de escritura se ocultan a quien
  no puede escribir.

### 5.5 Proyectos

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-30 | CRUD de proyectos: código, nombre, descripción, cliente (interno o externo), líder, metodología (Scrum, Kanban, Cascada), prioridad, fechas planeadas, presupuesto en horas y monto. | Alta |
| RF-31 | Estados del proyecto: `planning`, `active`, `on_hold`, `completed`, `cancelled`, con transiciones válidas (ver `docs/DATA.md`). | Alta |
| RF-32 | Hitos (milestones) por proyecto con fecha compromiso y estado. | Alta |
| RF-33 | Ficha del proyecto con resumen de KPIs propios, equipo asignado, Gantt y Burndown. | Alta |
| RF-34 | Un proyecto de cliente externo es facturable por defecto; uno interno, no facturable. | Alta |

### 5.6 Asignaciones

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-40 | Asignar miembros a proyectos con rol en el proyecto, % de dedicación (1–100) y periodo. | Alta |
| RF-41 | Al guardar, advertir si la suma de dedicación del miembro en periodos traslapados supera 100 %. | Alta |
| RF-42 | Solo miembros asignados al proyecto pueden ser responsables de sus tareas o registrar horas en él. | Alta |
| RF-43 | Matriz de asignaciones (miembros × proyectos) con filtro por rango de fechas. | Media |

**Decisiones de definición (proyectos, hitos y asignaciones, RF-30 a RF-43):**

- Permisos: cualquier usuario autenticado **lee**; solo `admin` y `pm` crean y editan proyectos,
  hitos y asignaciones (403 para `developer` y `viewer`). Cualquier `pm` puede editar cualquier proyecto.
- Código del proyecto: lo genera el sistema con el formato `PRJ-AAAA-NNN` (año de la fecha de inicio
  planeada y consecutivo por año con 3 dígitos); no es editable.
- Cliente: no se pueden crear proyectos para clientes inactivos (422) y el cliente no se puede cambiar
  cuando el proyecto ya salió de `planning`. `is_billable` toma por defecto el tipo del cliente
  (externo = facturable) y el `pm` puede modificarlo. El líder (`managerId`) debe ser un miembro activo.
- Completar un proyecto (`active → completed`): si hay tareas con estado distinto de `done`, responde
  422 `BUSINESS_RULE` con el conteo, salvo que se envíe `confirmOpenTasks: true` (en la vista, una
  casilla de confirmación). Al completar se asigna `actual_end_date` = hoy.
- Hitos: el estado se cambia manualmente (`pending`, `completed`, `missed`); al pasar a `completed` se
  guarda `completed_at` y se limpia al salir de ese estado. La fecha compromiso puede quedar fuera
  del rango planeado del proyecto.
- Asignaciones: el periodo debe quedar dentro del rango planeado del proyecto (422); solo miembros
  activos; la sobreasignación (> 100 %) se guarda con la advertencia `OVER_ALLOCATION` (ver `docs/DATA.md` §3.8).

**Decisiones de definición (fichas, carga y matriz, RF-12, RF-17, RF-23, RF-33, RF-43):**

- «Horas consumidas» (ficha del proyecto y de clientes) = registros de tiempo con estado `submitted` o
  `approved` (se excluyen borradores y rechazados). Las «horas facturables» son las de esos registros con
  `is_billable = 1`, y el **monto estimado** del cliente externo = horas facturables × tarifa por hora
  (en la moneda del cliente).
- Ficha del proyecto (RF-33): estado, cliente, líder, fechas, horas consumidas frente al presupuesto,
  miembros asignados y avance de hitos, además del equipo y los hitos. El Gantt y el Burndown se enlazan
  cuando existan (Etapas 8 y 9).
- Carga semanal (RF-23): semana lunes–domingo; el % de un miembro en una semana es la suma de
  `allocation_percent` de sus asignaciones cuyo periodo toca esa semana; alerta si supera 100 %. Los días
  hábiles de ausencia se muestran como informativos pero **no** modifican el porcentaje. Rango por
  defecto: 8 semanas desde la actual (`?from=&to=` en fechas).
- Matriz de asignaciones (RF-43): miembros × proyectos con la dedicación %; filtro `?from=&to=` (por
  defecto, los proyectos y asignaciones que tocan el rango de la carga).
- Ambas vistas son de lectura para cualquier usuario autenticado.

### 5.7 Tiempo de desarrolladores

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-50 | Registro de tiempo por fecha, proyecto, tarea (opcional), duración y descripción. | Alta |
| RF-51 | Hoja de tiempos semanal por miembro (vista de cuadrícula día × proyecto). | Alta |
| RF-52 | Flujo de aprobación: `draft → submitted → approved / rejected`. El líder del proyecto aprueba. | Alta |
| RF-53 | Validaciones: duración > 0 y ≤ 24 h por registro; no más de 24 h por miembro por día; no se registran fechas futuras. | Alta |
| RF-54 | Marca de facturable heredada del proyecto y editable por el líder. | Media |
| RF-55 | Exportación de horas a CSV por rango, proyecto o cliente. | Media |

**Decisiones de definición (registro de tiempo, RF-50 a RF-55):**

- Registro: cada usuario con miembro vinculado (`users.team_member_id`) registra **solo sus propias
  horas**; sin vínculo recibe 403. `admin` y `pm` no capturan a nombre de otros. El `viewer` no accede
  a registros individuales. Visibilidad: un `developer` ve únicamente sus registros; `admin` y `pm` ven
  todos.
- Validaciones (RF-53, `work_date` y «hoy» en la zona horaria de la aplicación): duración entera de 1 a
  1440 minutos; no se aceptan fechas futuras; la suma diaria del miembro (todos los estados) no supera
  1440 minutos; el miembro debe tener una asignación vigente al proyecto en `work_date`; la tarea, si se
  indica, pertenece al proyecto.
- Flujo (RF-52): el autor puede **enviar** un registro o **toda una semana** (lunes–domingo) de golpe
  (sus `draft` y `rejected`). Solo `draft` y `rejected` son editables y eliminables por el autor; al
  editar un `rejected` vuelve a `draft` y se limpia el motivo. `submitted` y `approved` son de solo lectura.
- Aprobación: aprueba o rechaza el **líder del proyecto** (`projects.manager_id` vinculado a su usuario)
  o un `admin`; un `pm` que no lidera el proyecto recibe 403 y **nadie aprueba sus propios registros**
  (422). Rechazar exige un motivo.
- Facturable (RF-54): `is_billable` se hereda de `projects.is_billable` al crear y solo lo modifican el
  líder del proyecto o un `admin` (el autor no); queda en bitácora.
- Exportación CSV (RF-55): solo `admin` y `pm`; filtros por rango, proyecto, cliente y estado; UTF-8 con
  BOM, separador coma, horas con 2 decimales y celdas protegidas contra inyección de fórmulas.

### 5.8 Planeación

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-60 | Sprints por proyecto: nombre, objetivo, fechas y estado (`planned`, `active`, `closed`). Solo un sprint activo por proyecto. | Alta |
| RF-61 | Tareas: título, descripción, tipo (feature, bug, chore, spike), prioridad, story points, horas estimadas, fechas de inicio y fin, responsable, sprint e hito. | Alta |
| RF-62 | Estados de tarea: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`. Cada cambio queda en historial. | Alta |
| RF-63 | Backlog del proyecto y tablero Kanban por sprint con arrastrar y soltar. | Alta |
| RF-64 | Dependencias entre tareas (fin-a-inicio) sin ciclos. | Media |
| RF-65 | Subtareas (una tarea puede tener tarea padre). | Baja |
| RF-66 | Al cerrar un sprint, las tareas no terminadas regresan al backlog o pasan al siguiente sprint. | Media |

**Decisiones de definición (sprints y tareas, RF-60 a RF-66):**

- Permisos: cualquier usuario autenticado **lee**. `admin` y `pm` crean y editan sprints, tareas,
  dependencias y orden. Un `developer` solo puede **cambiar el estado** (incluido arrastrar en el
  Kanban) de las tareas cuyo responsable es su miembro vinculado (`users.team_member_id`); en las
  demás recibe 403. El `viewer` solo lee.
- Estados de tarea: cualquier transición entre estados es válida y siempre queda en el historial.
  Al asignar una tarea en `backlog` a un sprint pasa a `todo`; al quitarla del sprint (si no está
  `done`) regresa a `backlog`. Una tarea `done` no se saca de su sprint. El responsable debe estar
  asignado al proyecto (RF-42).
- Sprints: sus fechas deben quedar dentro del rango del proyecto y no traslaparse con otros sprints
  del mismo proyecto. **Iniciar** (`planned → active`): exige que no haya otro activo y fija
  `committed_points` = suma de puntos de sus tareas. **Cerrar** (`active → closed`): fija
  `completed_points` = suma de puntos de sus tareas `done`; las no terminadas pasan al backlog
  (estado `backlog`) o a un sprint `planned` indicado en `moveTo` (por defecto, backlog). Un sprint
  `closed` es de solo lectura y no admite tareas nuevas.
- Subtareas: un solo nivel (una subtarea no tiene subtareas) y del mismo proyecto. Siguen el sprint
  de su tarea padre. Cada subtarea tiene sus propios puntos y todas (padre y subtareas) suman en
  `committed_points` y `completed_points`. Un padre no puede pasar a `done` mientras tenga subtareas
  que no estén `done` (422).

### 5.9 Diagrama de Gantt

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-70 | Gantt por proyecto con tareas e hitos en el tiempo, agrupables por sprint. | Alta |
| RF-71 | Vistas por día, semana y mes. | Alta |
| RF-72 | Mostrar dependencias, % de avance y línea del día actual. | Alta |
| RF-73 | Reprogramar arrastrando la barra (solo `admin`/`pm`), persistiendo las nuevas fechas. | Media |
| RF-74 | Gantt de portafolio: un renglón por proyecto activo. | Media |

**Decisiones de definición (Gantt, RF-70 a RF-74):**

- Datos del Gantt: se dibujan las tareas (y subtareas) que tienen fecha de inicio y de fin; las demás
  se listan como «sin programar». Los hitos se dibujan como barra de un día. Las tareas se ordenan por
  fecha de inicio y pueden agruparse por sprint (`groupBy=sprint`; el backlog al final). Lectura para
  cualquier usuario autenticado.
- Reprogramar (RF-73, solo `admin` y `pm`): al cambiar las fechas de una tarea (arrastrando o por
  cualquier edición) el servidor exige que (a) inicie **después** de que termine cada predecesora
  (fin-a-inicio), (b) termine **antes** de que inicie cada sucesora, y (c) quede dentro del rango
  planeado del proyecto. Si no se cumple responde 422 con el motivo y la barra regresa a su lugar.
  No se mueven otras tareas automáticamente (sin cascada).
- Los hitos son de solo lectura en el Gantt; su fecha se edita en la ficha del proyecto.
- Gantt de portafolio (RF-74): solo proyectos `active`, un renglón por proyecto (inicio → fin
  planeados). Avance = puntos de historia en `done` ÷ puntos totales de sus tareas; sin puntos, tareas
  `done` ÷ tareas; sin tareas, 0.
- Avance de una tarea: 100 si está `done`; si no, horas registradas (enviadas y aprobadas) ÷ horas
  estimadas, con tope de 95; sin estimación, 0.

### 5.10 Burndown Chart

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-80 | Burndown por sprint: puntos restantes reales vs. línea ideal, día a día. | Alta |
| RF-81 | Se guarda una instantánea diaria por sprint activo; el punto del día actual se recalcula con cada cambio de tarea. | Alta |
| RF-82 | Indicar cambios de alcance (puntos agregados o retirados durante el sprint). | Media |
| RF-83 | Burndown alternativo por horas restantes. | Baja |
| RF-84 | Burnup de proyecto (alcance total vs. completado). | Baja |

**Decisiones de definición (Burndown, RF-80 a RF-84):**

- Lectura para cualquier usuario autenticado. Hay instantáneas solo para sprints `active` y `closed`
  (al iniciar se guarda la del día 0 y al cerrar se guarda la final del día de cierre).
- Eje de días: del `start_date` al `end_date` del sprint. Un día **pasado** sin instantánea (servidor
  apagado) arrastra el último valor conocido —es exacto porque todo cambio de tarea recalcula el día—;
  los días anteriores al inicio real del sprint y los futuros tienen valor real `null`.
- Línea ideal: el primer día hábil (lunes a viernes, sin festivos) vale los puntos comprometidos
  (`committed_points`) y el último día hábil vale 0, descendiendo linealmente entre días hábiles; los
  fines de semana repiten el valor previo; un sprint de un solo día hábil termina en 0.
- Cambio de alcance (RF-82) de un día = `total_points(d) − total_points(d−1)` (0 en la primera
  instantánea). Burndown por horas (RF-83): `remaining_minutes` = suma de `estimated_minutes` de las
  tareas no terminadas; su ideal parte de las horas restantes de la primera instantánea.
- Burnup de proyecto (RF-84): por día, alcance = suma del `total_points` y completado = suma del
  `completed_points` de la última instantánea de cada uno de sus sprints; no incluye tareas que nunca
  estuvieron en un sprint. Como al cerrar un sprint sus tareas no terminadas salen de él (al backlog o
  a otro sprint), a partir del día siguiente al cierre un sprint cerrado aporta al alcance solo sus
  puntos completados, para no contar dos veces las tareas que continúan en otro sprint.

### 5.11 Tablero de KPIs en tiempo real

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-90 | Tablero principal con los KPIs de §6 en tarjetas y gráficas. | Alta |
| RF-91 | Actualización en tiempo real (SSE) cuando cambian tareas, horas, asignaciones o proyectos, sin recargar la página. | Alta |
| RF-92 | Filtros: rango de fechas, tipo de cliente (interno/externo), cliente, proyecto, líder. | Alta |
| RF-93 | Semáforo (verde/ámbar/rojo) por KPI según umbrales configurables. | Media |
| RF-94 | Listado "Proyectos en riesgo" con la causa (SPI bajo, fecha vencida, sobreconsumo de horas). | Alta |
| RF-95 | Indicador de conexión en vivo y hora de última actualización. | Media |

### 5.12 Notificaciones (v0.3)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-100 | Notificaciones dentro de la aplicación: campana con contador de no leídas en el encabezado y página `/notifications` (listado paginado, marcar una o todas como leídas). Se actualizan en vivo (SSE). | Alta |
| RF-101 | Copia por correo a quien lo tenga activado (por defecto sí). Solo existe si hay un servidor SMTP configurado; sin SMTP las notificaciones siguen funcionando dentro de la aplicación. | Alta |
| RF-102 | Avisos generados por el sistema (tabla de §5.12.1). Nadie recibe aviso de una acción que hizo él mismo. | Alta |
| RF-103 | Preferencia personal en `/account/notifications`: activar o desactivar el correo. | Media |
| RF-104 | Sin duplicados: cada aviso periódico tiene una clave de deduplicación; las notificaciones leídas se eliminan a los 90 días. | Media |

#### 5.12.1 Avisos

| Tipo | Cuándo | Destinatario |
|---|---|---|
| `hours_midweek` | Miércoles 09:00 (zona de la aplicación): si las horas registradas de lunes a hoy son menos del 50 % de su capacidad semanal | El miembro (usuario vinculado) |
| `hours_close` | Viernes 09:00: si tiene registros sin enviar (borrador o rechazados) o lleva menos del 80 % de su capacidad | El miembro |
| `hours_to_review` | Al enviar horas (registro o semana) | El líder del proyecto |
| `hours_approved`, `hours_rejected` | Al aprobar o rechazar un registro (el rechazo incluye el motivo) | El autor del registro |
| `task_assigned` | Al crear o reasignar una tarea con responsable | El responsable |
| `task_overdue` | Diario 09:00: tarea no terminada con fecha fin pasada (una vez por tarea) | El responsable |
| `task_blocked` | Al pasar una tarea a «bloqueada» | El líder del proyecto |
| `milestone_overdue` | Diario 09:00: hito pendiente con fecha pasada (una vez por hito) | El líder del proyecto |
| `task_comment` | Al comentar una tarea | El responsable y el líder del proyecto (no a quien comenta ni a los mencionados, que reciben `task_mention`) |
| `task_mention` | Al mencionar con `@correo` en un comentario nuevo | La persona mencionada (usuario activo) |
| `project_at_risk` | Diario 09:00: proyecto que cumple la regla de riesgo de §6 (a lo más una vez por semana y proyecto) | El líder del proyecto |

**Decisiones:**

- «Líder del proyecto» = el usuario activo vinculado al miembro líder (`projects.manager_id`); si no hay usuario vinculado, todos los administradores activos.
- Los avisos periódicos se revisan a las 09:00 de la zona de la aplicación y también al arrancar (la deduplicación evita repetirlos), de modo que una caída del servicio no los pierde.
- El correo es un mensaje de texto con título, detalle y enlace absoluto (`APP_URL`). Un fallo de envío se registra en el log y nunca interrumpe la operación.
- Las preferencias por tipo de aviso no existen en esta versión: solo el interruptor de correo.

### 5.13 Mi día (v0.3)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-110 | La página de inicio muestra un panel según el rol, actualizado en vivo. | Alta |
| RF-111 | `developer`: sus tareas abiertas (vencidas primero), horas de la semana frente a su capacidad, registros por enviar y rechazados (con motivo). | Alta |
| RF-112 | `pm` y `admin`: horas por aprobar, proyectos en riesgo (los que lidera el `pm`; todos para el `admin`), hitos vencidos o próximos (7 días) y tareas bloqueadas de sus proyectos. | Alta |
| RF-113 | `viewer`: proyectos activos con su avance y acceso al tablero. | Media |
| RF-114 | Todos ven sus últimas notificaciones sin leer. | Media |

### 5.14 Importación por CSV (v0.3)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-120 | `admin` y `pm` importan **clientes**, **miembros del equipo** y **tareas de un proyecto** desde un CSV (UTF-8, con cabecera, separador coma o punto y coma). | Alta |
| RF-121 | Flujo en dos pasos: **Validar** (vista previa con el error de cada fila) e **Importar**, que solo está disponible si todas las filas son válidas: todo o nada, en una sola transacción. | Alta |
| RF-122 | Máximo 1 000 filas y 1 MB por archivo. Plantilla descargable por entidad. | Media |
| RF-123 | Cada alta pasa por las mismas reglas que la pantalla (esquemas Zod y services), queda en la bitácora y emite sus eventos tras confirmar. | Alta |

**Decisiones:**

- Cabeceras en español, una por campo (plantillas): clientes `tipo, nombre, departamento, centro_costos, razon_social, rfc, tarifa_hora, moneda, direccion, contacto, correo_contacto, telefono_contacto, notas`; miembros `nombre, apellido, correo, puesto, nivel, horas_semana, costo_hora, fecha_ingreso`; tareas `titulo, tipo, prioridad, puntos, estimacion_horas, responsable_correo, fecha_inicio, fecha_fin, descripcion`.
- Duplicados: un cliente con el mismo tipo y nombre, o un miembro con el mismo correo, se marcan como error de la fila (no se actualizan registros existentes).
- Las tareas entran al backlog del proyecto elegido; el responsable se identifica por el correo del miembro, que debe estar asignado al proyecto (RF-42).
- El archivo se lee en el navegador y se envía como texto (sin dependencia de carga de archivos).

### 5.15 Comentarios y menciones (v0.4)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-130 | Cada tarea tiene una conversación: comentarios en texto plano (hasta 4 000 caracteres, con saltos de línea), ordenados del más antiguo al más nuevo, con autor y fecha. | Alta |
| RF-131 | Pueden comentar `admin`, `pm` y los `developer` asignados al proyecto de la tarea; el `viewer` solo lee. | Alta |
| RF-132 | El autor edita o elimina su propio comentario; el `admin` elimina cualquiera. Los comentarios editados muestran «editado». Altas, ediciones y bajas quedan en la bitácora. | Alta |
| RF-133 | Menciones: escribir `@correo` de un usuario activo (con el correo completo) le envía una notificación (v0.3). Al comentar también se avisa al responsable de la tarea y al líder del proyecto. Nadie recibe aviso de su propio comentario. | Alta |
| RF-134 | La conversación se actualiza en vivo (SSE) en la ficha de la tarea. | Media |

### 5.16 Adjuntos (v0.4)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-140 | Una tarea admite archivos adjuntos (hasta 5 MB cada uno y 10 por tarea) de una lista permitida: imágenes (PNG, JPEG, GIF, WebP), PDF, texto (`.txt`) y CSV, y Office (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`). | Alta |
| RF-141 | Suben `admin`, `pm` y los `developer` asignados al proyecto; todos los usuarios que ven la tarea pueden descargar. Quien subió el archivo (o un `admin`) lo elimina. | Alta |
| RF-142 | Los archivos se guardan fuera de `public/`, con nombre aleatorio; solo se sirven por una ruta autenticada, siempre como descarga (`Content-Disposition: attachment`) y con `X-Content-Type-Options: nosniff`. El nombre original se conserva solo como texto. | Alta |
| RF-143 | Se valida la firma del archivo (no solo la extensión) y se rechazan los tipos fuera de la lista (p. ej. HTML, SVG, ejecutables). | Alta |
| RF-144 | Los respaldos incluyen la carpeta de adjuntos (`npm run db:backup`): junto a cada `devpm-AAAAMMDD-HHmm.db` se guarda `devpm-AAAAMMDD-HHmm.uploads/`, con la misma retención. | Media |

### 5.17 Búsqueda global y filtros guardados (v0.4)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-150 | Caja de búsqueda en el encabezado y página `/search?q=`: proyectos (código, nombre), tareas (título), clientes (nombre, razón social) y miembros del equipo (nombre, correo). Resultados agrupados, máximo 10 por grupo con enlace a «ver más». | Alta |
| RF-151 | Los resultados respetan los permisos: el `viewer` y el `developer` no ven clientes externos con datos fiscales ni costos; la búsqueda nunca devuelve más de lo que ya muestran los listados. | Alta |
| RF-152 | Filtros guardados por usuario para los listados de proyectos, tareas del backlog y tiempo: nombre, ámbito y filtros; hasta 20 por persona; se aplican con un clic. | Media |
| RF-153 | La búsqueda responde en < 300 ms (p95) con el volumen de RNF-01; si no, se evalúa FTS5. | Media |

**Decisiones aprobadas (7 nov 2026):**

1. **Comentarios** solo en texto plano (sin formato ni imágenes incrustadas), menciones solo con el correo completo.
2. **Adjuntos** en disco (`data/uploads/`, `UPLOAD_DIR`), sin dependencias nuevas: subida con cuerpo binario (`express.raw`) y el nombre en un parámetro, que el navegador envía con `fetch`.
3. Sin antivirus integrado: se documenta el riesgo y se limita por tipo, tamaño y descarga forzada.
4. **Búsqueda** con `LIKE` escapado en esta versión; FTS5 solo si la prueba de rendimiento lo exige.
5. Detalles de comentarios: editar un comentario no vuelve a avisar; eliminar un comentario no retira los avisos ya enviados; un mismo comentario genera un solo aviso por persona (la mención gana al aviso de comentario).
6. Adjuntos: el tamaño máximo es 5 MB (`UPLOAD_MAX_MB` solo puede bajarlo, de 1 a 5); la extensión debe coincidir con el contenido detectado; el nombre original se limpia (sin rutas ni caracteres de control, máx. 120 caracteres); los archivos huérfanos se eliminan al arrancar y al borrar una tarea; sin vista previa en línea (solo descarga).
7. Fuera de esta versión: hilos o respuestas anidadas, reacciones, adjuntos en proyectos o clientes, búsqueda dentro de adjuntos.

## 6. KPIs

Todos los KPIs respetan los filtros del tablero. Horas = minutos / 60 (redondeo a 1 decimal en UI).
"Aprobadas" se refiere a `time_entries.status = 'approved'`; los KPIs operativos usan horas
`submitted` + `approved` para no esperar la aprobación.

| # | KPI | Fórmula | Verde | Ámbar | Rojo |
|---|---|---|---|---|---|
| K1 | Proyectos activos | conteo de proyectos con `status = 'active'` (desglose por estado) | — | — | — |
| K2 | Avance del proyecto (%) | story points `done` / story points totales × 100 | — | — | — |
| K3 | SPI (índice de desempeño de calendario) | EV / PV, donde EV = % avance × presupuesto en horas y PV = % de tiempo transcurrido del plan × presupuesto en horas | ≥ 0.95 | 0.85–0.95 | < 0.85 |
| K4 | CPI (índice de desempeño de costo, en horas) | EV / AC, donde AC = horas registradas en el proyecto | ≥ 0.95 | 0.85–0.95 | < 0.85 |
| K5 | Consumo de presupuesto (%) | horas registradas / presupuesto en horas × 100 | ≤ avance + 10 | ≤ avance + 20 | > avance + 20 |
| K6 | Utilización del equipo (%) | horas registradas / capacidad disponible × 100 (capacidad = capacidad semanal prorrateada − ausencias) | 75–95 | 60–75 ó 95–105 | < 60 ó > 105 |
| K7 | Miembros sobreasignados | conteo de miembros con suma de dedicación > 100 % en el periodo | 0 | 1–2 | ≥ 3 |
| K8 | Velocidad del sprint | story points `done` en el sprint cerrado; se muestra promedio móvil de los últimos 3 | — | — | — |
| K9 | Cumplimiento de compromiso del sprint (%) | puntos completados / puntos comprometidos al inicio × 100 | ≥ 85 | 70–85 | < 70 |
| K10 | Tareas vencidas | tareas no `done` con `due_date` < hoy | 0 | 1–5 | > 5 |
| K11 | Tareas bloqueadas | tareas con `status = 'blocked'` | 0 | 1–3 | > 3 |
| K12 | Cycle time promedio (días) | promedio de (fecha a `done` − primera fecha en `in_progress`) en el periodo | — | — | — |
| K13 | Horas facturables vs. no facturables | suma de horas por bandera `billable`, y por tipo de cliente | — | — | — |
| K14 | Ingreso estimado | Σ horas facturables aprobadas × tarifa del cliente externo | — | — | — |
| K15 | Hitos vencidos | hitos no completados con `due_date` < hoy | 0 | 1 | > 1 |
| K16 | Registro de horas de la semana (%) | horas registradas en la semana / capacidad de la semana × 100 | ≥ 95 | 80–95 | < 80 |

**Proyecto en riesgo** (RF-94): proyecto `active` que cumple al menos una condición:
SPI < 0.85, CPI < 0.85, fecha fin planeada < hoy, consumo de presupuesto > avance + 20 puntos,
o algún hito vencido.

Los umbrales son valores iniciales y deben poder ajustarse en configuración (RF-93).

### 6.1 Decisiones de definición del tablero (Etapa 10)

- **Periodo:** por defecto los **últimos 30 días** (de hoy − 29 a hoy, zona horaria de la aplicación),
  editable con `from` y `to`. Usan el periodo K6, K7, K12, K13 y K14; K16 usa siempre la semana actual
  (lunes a domingo); K1 a K5, K10, K11 y K15 son **acumulados al día de hoy** (K4 y K5 comparan contra
  las horas registradas en todo el proyecto, porque el avance es acumulado); K8 y K9 usan los últimos 3
  sprints cerrados (por fecha de fin) de los proyectos filtrados.
- **Agregación (portafolio):** K3 a K5 se calculan sobre los proyectos `active` filtrados con
  presupuesto de horas > 0: K3 = Σ EV ÷ Σ PV, K4 = Σ EV ÷ Σ horas, K5 = Σ horas ÷ Σ presupuesto × 100.
  K2 = puntos `done` ÷ puntos totales de esos mismos proyectos (los puntos incluyen subtareas). Además cada proyecto activo aparece
  con sus propios K2 a K5 en una tabla. Si un denominador es 0 el KPI vale `null` y se muestra «—».
  El semáforo de K5 se compara con el avance (K2) del mismo conjunto.
- **Horas:** los KPIs operativos usan registros `submitted` y `approved`; K14 (ingreso estimado) solo
  `approved`. El % transcurrido del plan (PV) = días entre el inicio y hoy ÷ días del plan, entre 0 y 1.
- **Alcance de miembros (K6, K16):** sin filtros de proyecto, cliente ni líder cuentan todos los miembros
  activos; con alguno de esos filtros, solo los miembros asignados (en el periodo) a los proyectos
  filtrados, y las horas son las de esos proyectos.
- **Capacidad (K6, K16):** por miembro activo = capacidad semanal ÷ 5 por cada día hábil (lunes a
  viernes) del periodo, menos los días hábiles de ausencia (unión de `time_off`, cualquier tipo).
- **K7:** cuenta los miembros que en algún día del periodo suman más de 100 % de dedicación entre sus
  asignaciones de proyectos `planning` y `active` (de cualquier proyecto), evaluado día por día en días
  hábiles; solo se consideran los miembros asignados a los proyectos filtrados.
- **K8/K9:** K8 = puntos `done` del último sprint cerrado y su promedio móvil de los 3 últimos; K9 =
  Σ completados ÷ Σ comprometidos de los 3 últimos sprints cerrados.
- **K10, K11 y K15:** consideran los proyectos filtrados en estado `planning`, `active` u `on_hold`.
- **K12:** promedio en días entre `started_at` y `completed_at` de las tareas terminadas dentro del periodo.
- **K14:** Σ horas facturables aprobadas × tarifa del cliente externo, **por moneda** (sin convertir);
  solo lo ven `admin` y `pm` (para los demás el campo se omite).
- **Filtros (RF-92):** `from`, `to`, tipo de cliente, cliente, proyecto y líder; los KPIs respetan los
  filtros salvo los que son «al día de hoy», que respetan los filtros de proyecto, cliente y líder.
- **Umbrales (RF-93):** viven en `settings` (clave `kpi.thresholds`, JSON validado) con los valores de
  la tabla como defecto; solo `admin` los edita (página `/admin/settings/kpis` y API), puede restablecerlos
  y cada cambio queda en bitácora y emite un evento para refrescar los tableros abiertos.
- **Lectura:** el tablero es visible para cualquier usuario autenticado; el SSE solo envía
  notificaciones sin datos.

## 7. Requerimientos no funcionales

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Rendimiento | Páginas de listado y API responden en < 300 ms (p95) con 50 proyectos, 50 miembros y 100 000 registros de tiempo. |
| RNF-02 | Tiempo real | Un cambio se refleja en los tableros abiertos en ≤ 2 s. |
| RNF-03 | Concurrencia | Hasta 50 usuarios simultáneos; SQLite en modo WAL. |
| RNF-04 | Seguridad | Contraseñas con bcrypt (costo ≥ 12); cookies `HttpOnly`, `SameSite=Strict`, `Secure` en producción; cabeceras con helmet y CSP sin CDNs; límite de intentos de login. |
| RNF-05 | Seguridad | Validación de toda entrada con esquemas; SQL solo con parámetros; salida HTML escapada. |
| RNF-06 | Auditoría | Las altas, cambios y bajas de entidades principales quedan en bitácora con usuario y fecha. |
| RNF-07 | Usabilidad | Interfaz en español, responsiva (≥ 360 px), accesible (contraste AA, navegación con teclado). |
| RNF-08 | Mantenibilidad | Cobertura de pruebas ≥ 80 % en services; lint sin errores. |
| RNF-09 | Respaldo | Script de respaldo en caliente de la BD (`VACUUM INTO`) con retención configurable. |
| RNF-10 | Portabilidad | Se ejecuta con `npm install && npm run db:migrate && npm start`, sin servicios externos. |
| RNF-11 | Zona horaria | Marcas de tiempo en UTC; fechas de calendario según la zona configurada (por defecto `America/Mexico_City`). |
| RNF-12 | Apariencia | Identidad visual en **azul marino** (paleta `navy`). Modo claro y oscuro: por defecto sigue la preferencia del sistema (`prefers-color-scheme`) y el usuario puede forzar «Claro» u «Oscuro» desde el encabezado; la elección se guarda solo en su navegador. Ambos modos cumplen contraste AA (RNF-07). |

### 7.1 Decisiones de definición del rediseño visual (Etapa 12)

- Se adopta el diseño **D «Dashboard Enfoque»**: riel de iconos a la izquierda, encabezado azul marino con
  el título de la página y los controles de sesión, y tarjetas de KPI con barra de color lateral.
- Las tarjetas de KPI muestran etiqueta en mayúsculas, valor grande, detalle y la línea «Semáforo: Verde |
  Ámbar | Rojo» (el color nunca es el único indicador). Los KPI sin umbral dicen «Sin semáforo».
- El selector de tema tiene tres opciones: **Sistema** (por defecto), **Claro** y **Oscuro**. Se guarda en
  `localStorage` (`devpm.theme`); no se envía al servidor ni cambia el modelo de datos.
- «Tiempo» del menú: un `admin` o `pm` sin miembro vinculado no tiene hoja propia, así que `/time` lo lleva a
  `/time/approvals` (la API `/api/v1/time-sheet` sigue respondiendo 403). Un `developer` sin vínculo conserva el 403.
- El cambio es solo de presentación: no modifica rutas, permisos, fórmulas de KPIs ni la API.

### 7.2 Decisiones de endurecimiento de seguridad (Etapa 14)

- El límite de `LOGIN_MAX_ATTEMPTS` intentos fallidos / 15 min se aplica **por IP y, al doble, por cuenta**; el mensaje al usuario es el mismo.
- Se registran en el log los inicios de sesión fallidos y los bloqueos (sin contraseñas).
- Las contraseñas conservan el mínimo de 8 caracteres y no pueden pasar de 72 bytes UTF-8.
- Las peticiones que modifican datos y que el navegador marca como `Sec-Fetch-Site: cross-site` se rechazan.
- Los ID de sesión se guardan con hash; **al actualizar se cierran las sesiones abiertas** y cada persona vuelve a iniciar sesión.
- Los respaldos se guardan con permisos restringidos (`0600`, carpeta `0700`).

## 8. Criterios de aceptación del MVP

1. Un `pm` puede crear un cliente externo, un proyecto para ese cliente, asignar 3 miembros,
   crear un sprint con tareas y verlas en Gantt y en el tablero Kanban.
2. Un `developer` mueve una tarea a `done` y el Burndown del sprint y el tablero de KPIs se
   actualizan en otra pestaña abierta en ≤ 2 s sin recargar.
3. Un `developer` registra horas en su hoja semanal; el `pm` las aprueba y K4, K6 y K13 cambian.
4. Asignar a un miembro al 60 % en dos proyectos traslapados muestra una alerta de sobreasignación y K7 = 1.
5. Un proyecto con fecha fin vencida aparece en "Proyectos en riesgo" con la causa.
6. Un `viewer` no puede crear ni modificar información (respuesta 403 en API, controles ocultos en UI).

### 8.1 Verificación automatizada de los criterios

| Criterio | Prueba |
|---|---|
| 1. Cliente externo, proyecto, 3 miembros, sprint con tareas, Gantt y Kanban | `tests/integration/acceptance-mvp.test.js` (§8.1) |
| 2. Tarea a `done` → Burndown y KPIs en ≤ 2 s sin recargar | `tests/integration/acceptance-kpis.test.js` (§8.2, con SSE real); medido en un navegador: ~0,5 s |
| 3. Horas registradas, enviadas y aprobadas → K4, K6 y K13 cambian | `tests/integration/acceptance-kpis.test.js` (§8.3) y `time-flow.test.js` |
| 4. 60 % + 60 % → alerta de sobreasignación y K7 = 1 | `tests/integration/acceptance-kpis.test.js` (§8.4) |
| 5. Proyecto con fecha fin vencida en «Proyectos en riesgo» con la causa | `tests/integration/acceptance-kpis.test.js` (§8.5) |
| 6. Viewer: 403 en la API y controles ocultos en la UI | `tests/integration/acceptance-mvp.test.js` (§8.6) |

## 9. Fuera de alcance (v1)

- Facturación electrónica, cobranza o integración contable.
- Integraciones con GitHub/GitLab/Jira (posible en v2).
- Aplicación móvil nativa.
- Multiempresa (multi-tenant).
- Preferencias de notificación por tipo de aviso y notificaciones push (posibles después de la v0.3).

## 10. Supuestos y riesgos

| Tipo | Descripción | Mitigación |
|---|---|---|
| Supuesto | Un solo servidor; volumen de datos moderado | SQLite es suficiente; la capa repository permite migrar a otro motor |
| Riesgo | Bloqueos de escritura en SQLite con mucha concurrencia | WAL, `busy_timeout`, transacciones cortas |
| Riesgo | Los desarrolladores no registran horas a tiempo | KPI K16 visible y recordatorio en la UI |
| Riesgo | El SSE se corta detrás de proxies | Heartbeat cada 25 s y reconexión automática de `EventSource` |

## 11. Roadmap por fases

Las etapas detalladas y su estado viven en `CHECKLIST.md`.

| Fase | Contenido |
|---|---|
| F0 | Documentación y repositorio |
| F1 | Base técnica: scaffolding, BD, autenticación |
| F2 | Catálogos: clientes internos/externos y equipo |
| F3 | Proyectos, hitos y asignaciones |
| F4 | Planeación (sprints, tareas, Kanban) y registro de tiempo |
| F5 | Gantt y Burndown |
| F6 | Tablero de KPIs en tiempo real |
| F7 | Endurecimiento: seguridad, rendimiento, respaldo y despliegue |
| F8 (v0.3) | Adopción: notificaciones, «Mi día» e importación por CSV |
| F9 (v0.4) | Colaboración: comentarios y menciones, adjuntos, búsqueda global y filtros guardados |
