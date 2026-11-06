import { AppError } from '../../lib/AppError.js';
import { diff, recordAudit } from '../../lib/audit.js';
import { nowIso } from '../../lib/dates.js';
import { recordTaskStatus } from '../../lib/taskHistory.js';

export const toDto = (r) => ({
  id: r.id,
  projectId: r.project_id,
  sprintId: r.sprint_id,
  sprintName: r.sprint_name,
  milestoneId: r.milestone_id,
  parentTaskId: r.parent_task_id,
  subtaskCount: r.subtask_count,
  title: r.title,
  description: r.description,
  type: r.type,
  status: r.status,
  priority: r.priority,
  storyPoints: r.story_points,
  estimatedMinutes: r.estimated_minutes,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  startDate: r.start_date,
  dueDate: r.due_date,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  sortOrder: r.sort_order,
});

const BOARD_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'];
const DERIVED = ['assignee_name', 'sprint_name', 'subtask_count'];

/** Casos de uso de tareas (RF-61, RF-62, RF-65, RF-42). */
export function createTasksService({ db, repository, snapshots = null }) {
  function requireProject(projectId) {
    if (!repository.projectExists(projectId)) throw AppError.notFound('Proyecto no encontrado');
  }
  function requireTask(id) {
    const row = repository.findById(id);
    if (!row) throw AppError.notFound('Tarea no encontrada');
    return row;
  }
  function assertEditable(task) {
    if (task.sprint_id !== null && repository.findSprint(task.sprint_id)?.status === 'closed') {
      throw AppError.businessRule('La tarea pertenece a un sprint cerrado (solo lectura)');
    }
  }
  function checkAssignee(projectId, assigneeId) {
    if (assigneeId === null || assigneeId === undefined) return;
    if (!repository.memberExists(assigneeId))
      throw AppError.businessRule('El responsable no existe');
    if (!repository.isAssigned(projectId, assigneeId)) {
      throw AppError.businessRule('El responsable debe estar asignado al proyecto');
    }
  }
  function checkMilestone(projectId, milestoneId) {
    if (milestoneId === null || milestoneId === undefined) return;
    const m = repository.findMilestone(milestoneId);
    if (!m || m.project_id !== projectId) {
      throw AppError.businessRule('El hito debe pertenecer al proyecto');
    }
  }
  function checkSprint(projectId, sprintId) {
    if (sprintId === null || sprintId === undefined) return;
    const s = repository.findSprint(sprintId);
    if (!s || s.project_id !== projectId)
      throw AppError.businessRule('El sprint debe pertenecer al proyecto');
    if (s.status === 'closed')
      throw AppError.businessRule('No se pueden agregar tareas a un sprint cerrado');
  }
  /**
   * RF-73: valida las fechas de una tarea. Dentro del rango del proyecto y, si es una tarea
   * existente, respetando las dependencias fin-a-inicio: debe iniciar después de que termine cada
   * predecesora y terminar antes de que inicie cada sucesora. Solo se revisa lo que se modifica.
   */
  function checkSchedule(projectId, taskId, { start, due, checkStart, checkDue }) {
    const range = repository.projectRange(projectId);
    const outside =
      (checkStart && start && (start < range.start_date || start > range.end_date)) ||
      (checkDue && due && (due < range.start_date || due > range.end_date));
    if (outside) {
      throw AppError.businessRule(
        `Las fechas deben quedar dentro del proyecto (${range.start_date} a ${range.end_date})`,
      );
    }
    if (taskId === null) return;
    if (checkStart && start) {
      const blocker = repository.predecessorDates(taskId).find((p) => start <= p.due_date);
      if (blocker) {
        throw AppError.businessRule(
          `Debe iniciar después de que termine «${blocker.title}» (${blocker.due_date})`,
        );
      }
    }
    if (checkDue && due) {
      const blocker = repository.successorDates(taskId).find((s) => due >= s.start_date);
      if (blocker) {
        throw AppError.businessRule(
          `Debe terminar antes de que inicie «${blocker.title}» (${blocker.start_date})`,
        );
      }
    }
  }

  const audit = (actorId, id, action, changes) =>
    recordAudit(db, { userId: actorId, entity: 'task', entityId: id, action, changes });

  /** Cambia el estado dentro de la transacción en curso: historial y fechas de inicio/fin. */
  function applyStatus(task, to, actorId) {
    if (task.status === to) return;
    const fields = { status: to };
    if (to === 'in_progress' && !task.started_at) fields.startedAt = nowIso();
    if (to === 'done') fields.completedAt = nowIso();
    repository.update(task.id, fields);
    if (to !== 'done' && task.status === 'done') repository.clearCompletedAt(task.id);
    recordTaskStatus(db, { taskId: task.id, from: task.status, to, userId: actorId });
  }

  /** Mueve una tarea (y por tanto sus subtareas) entre backlog y sprint con las reglas de estado. */
  function applySprint(task, sprintId, actorId) {
    if (task.sprint_id === sprintId) return;
    if (sprintId === null && task.status === 'done') {
      throw AppError.businessRule('Una tarea terminada no se saca de su sprint');
    }
    repository.update(task.id, { sprintId });
    if (sprintId === null) {
      if (task.status !== 'backlog') applyStatus({ ...task, sprint_id: null }, 'backlog', actorId);
    } else if (task.sprint_id === null && task.status === 'backlog') {
      applyStatus(task, 'todo', actorId);
    }
  }

  return {
    list(projectId, query) {
      requireProject(projectId);
      const { rows, total } = repository.list(query, projectId);
      return { data: rows.map(toDto), meta: { page: query.page, pageSize: query.pageSize, total } };
    },
    get: (id) => toDto(requireTask(id)),
    /** Tablero Kanban de un sprint (RF-63): una columna por estado. */
    board(sprintId) {
      const sprint = repository.sprintFull(sprintId);
      if (!sprint) throw AppError.notFound('Sprint no encontrado');
      const tasks = repository.sprintTasks(sprintId).map(toDto);
      return {
        sprint: {
          id: sprint.id,
          projectId: sprint.project_id,
          name: sprint.name,
          status: sprint.status,
          startDate: sprint.start_date,
          endDate: sprint.end_date,
          committedPoints: sprint.committed_points,
        },
        columns: BOARD_STATUSES.map((status) => {
          const cards = tasks.filter((t) => t.status === status);
          return {
            status,
            tasks: cards,
            points: cards.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0),
          };
        }),
      };
    },

    /** ¿Puede este usuario cambiar el estado de la tarea? (admin/pm, o developer en las suyas). */
    canMove(actor) {
      if (['admin', 'pm'].includes(actor.role)) return () => true;
      if (actor.role !== 'developer') return () => false;
      const memberId = repository.memberOfUser(actor.id);
      return (task) => memberId !== null && task.assigneeId === memberId;
    },

    backlog(projectId) {
      requireProject(projectId);
      return repository.backlog(projectId).map(toDto);
    },
    formOptions(projectId) {
      requireProject(projectId);
      return {
        project: repository.projectInfo(projectId),
        sprints: repository.openSprints(projectId),
        members: repository.assignedMembers(projectId),
      };
    },

    /**
     * Reordena el subconjunto `taskIds`: las tareas reciben, en el nuevo orden, los mismos lugares
     * (`sort_order`) que ocupaban, de modo que las demás conservan su posición relativa.
     */
    reorder(actorId, projectId, taskIds) {
      requireProject(projectId);
      if (new Set(taskIds).size !== taskIds.length) {
        throw AppError.businessRule('La lista contiene tareas repetidas');
      }
      db.transaction(() => {
        // Normaliza empates para que cada tarea tenga un lugar propio.
        const all = repository.projectTasks(projectId);
        all.forEach((t, i) => {
          if (t.sort_order !== i + 1) repository.setSortOrder(t.id, i + 1);
        });
        const slots = new Map(all.map((t, i) => [t.id, i + 1]));
        if (taskIds.some((id) => !slots.has(id))) {
          throw AppError.businessRule('Todas las tareas deben pertenecer al proyecto');
        }
        const places = taskIds.map((id) => slots.get(id)).sort((a, b) => a - b);
        taskIds.forEach((id, i) => repository.setSortOrder(id, places[i]));
      })();
      return repository.backlog(projectId).map(toDto);
    },

    /** Sube o baja una tarea un lugar dentro del backlog; en los extremos no hace nada. */
    moveInBacklog(actorId, projectId, taskId, direction) {
      const task = requireTask(taskId);
      if (task.project_id !== projectId) throw AppError.notFound('Tarea no encontrada');
      const ids = repository.backlog(projectId).map((t) => t.id);
      const from = ids.indexOf(taskId);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from === -1 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      this.reorder(actorId, projectId, ids);
    },

    subtasks(id) {
      requireTask(id);
      return repository.subtaskRows(id).map(toDto);
    },
    /** Opciones para los selectores de la página de la tarea. */
    taskOptions(projectId, exceptTaskId) {
      return {
        ...this.formOptions(projectId),
        milestones: repository.milestonesOf(projectId),
        tasks: repository.taskChoices(projectId, exceptTaskId),
      };
    },

    /** RF-64: predecesoras y sucesoras (fin-a-inicio) de una tarea. */
    dependencies(id) {
      requireTask(id);
      const dto = (t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        startDate: t.start_date,
        dueDate: t.due_date,
      });
      return {
        predecessors: repository.predecessorsOf(id).map(dto),
        successors: repository.successorsOf(id).map(dto),
      };
    },

    /** Agrega "taskId depende de dependsOnId"; ambas del mismo proyecto y sin ciclos. */
    addDependency(actorId, taskId, dependsOnId) {
      const task = requireTask(taskId);
      assertEditable(task);
      if (dependsOnId === taskId)
        throw AppError.businessRule('Una tarea no puede depender de sí misma');
      const dep = repository.findById(dependsOnId);
      if (!dep) throw AppError.businessRule('La tarea predecesora no existe');
      if (dep.project_id !== task.project_id) {
        throw AppError.businessRule('Las dos tareas deben pertenecer al mismo proyecto');
      }
      if (repository.dependencyExists(taskId, dependsOnId)) {
        throw AppError.conflict('La dependencia ya existe');
      }
      if (repository.dependsTransitively(dependsOnId, taskId)) {
        throw AppError.businessRule('La dependencia crearía un ciclo entre tareas');
      }
      db.transaction(() => {
        repository.insertDependency(taskId, dependsOnId);
        recordAudit(db, {
          userId: actorId,
          entity: 'task_dependency',
          entityId: taskId,
          action: 'create',
          changes: { dependsOn: [null, dependsOnId] },
        });
      })();
      return { taskId, dependsOnTaskId: dependsOnId, type: 'FS' };
    },

    removeDependency(actorId, taskId, dependsOnId) {
      const task = requireTask(taskId);
      assertEditable(task);
      if (!repository.dependencyExists(taskId, dependsOnId)) {
        throw AppError.notFound('Dependencia no encontrada');
      }
      db.transaction(() => {
        repository.removeDependency(taskId, dependsOnId);
        recordAudit(db, {
          userId: actorId,
          entity: 'task_dependency',
          entityId: taskId,
          action: 'delete',
          changes: { dependsOn: [dependsOnId, null] },
        });
      })();
    },

    history(id) {
      requireTask(id);
      return repository.historyOf(id).map((h) => ({
        id: h.id,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        changedBy: h.changed_by,
        changedByName: h.changed_by_name,
        changedAt: h.changed_at,
      }));
    },

    create(actorId, projectId, input) {
      requireProject(projectId);
      const fields = { ...input };
      if (input.parentTaskId) {
        const parent = requireTask(input.parentTaskId);
        if (parent.project_id !== projectId)
          throw AppError.businessRule('La tarea padre debe ser del mismo proyecto');
        if (parent.parent_task_id !== null)
          throw AppError.businessRule('Las subtareas solo tienen un nivel');
        if (input.sprintId !== undefined && input.sprintId !== parent.sprint_id) {
          throw AppError.businessRule('Una subtarea sigue el sprint de su tarea padre');
        }
        assertEditable(parent);
        fields.sprintId = parent.sprint_id;
      }
      checkSchedule(projectId, null, {
        start: input.startDate,
        due: input.dueDate,
        checkStart: input.startDate !== undefined,
        checkDue: input.dueDate !== undefined,
      });
      checkSprint(projectId, fields.sprintId);
      checkMilestone(projectId, input.milestoneId);
      checkAssignee(projectId, input.assigneeId);
      const id = db.transaction(() => {
        const status = fields.sprintId ? 'todo' : 'backlog';
        const newId = repository.insert(projectId, {
          ...fields,
          status,
          sortOrder: repository.nextSortOrder(projectId),
        });
        recordTaskStatus(db, { taskId: newId, from: null, to: status, userId: actorId });
        audit(actorId, newId, 'create', { title: [null, input.title] });
        return newId;
      })();
      snapshots?.recalculate([fields.sprintId]);
      return toDto(repository.findById(id));
    },

    update(actorId, id, input) {
      const before = requireTask(id);
      assertEditable(before);
      const start = input.startDate === undefined ? before.start_date : input.startDate;
      const due = input.dueDate === undefined ? before.due_date : input.dueDate;
      if (start && due && due < start) {
        throw AppError.validation('Datos inválidos', [
          { field: 'dueDate', message: 'La fecha de fin no puede ser anterior a la de inicio' },
        ]);
      }
      checkSchedule(before.project_id, id, {
        start,
        due,
        checkStart: input.startDate !== undefined && input.startDate !== before.start_date,
        checkDue: input.dueDate !== undefined && input.dueDate !== before.due_date,
      });
      if (input.assigneeId !== undefined && input.assigneeId !== before.assignee_id) {
        checkAssignee(before.project_id, input.assigneeId);
      }
      if (input.milestoneId !== undefined) checkMilestone(before.project_id, input.milestoneId);
      const { sprintId, ...rest } = input;
      const moving = sprintId !== undefined && sprintId !== before.sprint_id;
      if (moving) {
        if (before.parent_task_id !== null) {
          throw AppError.businessRule('Una subtarea sigue el sprint de su tarea padre');
        }
        checkSprint(before.project_id, sprintId);
        if (sprintId === null) {
          const blocked = [before, ...repository.subtasksOf(id)].some((t) => t.status === 'done');
          if (blocked) throw AppError.businessRule('Una tarea terminada no se saca de su sprint');
        }
      }
      db.transaction(() => {
        repository.update(id, rest);
        if (moving) {
          applySprint(before, sprintId, actorId);
          for (const sub of repository.subtasksOf(id)) applySprint(sub, sprintId, actorId);
        }
        const changes = diff(before, repository.findById(id));
        for (const k of DERIVED) delete changes[k];
        if (Object.keys(changes).length > 0) audit(actorId, id, 'update', changes);
      })();
      snapshots?.recalculate([before.sprint_id, repository.findById(id).sprint_id]);
      return toDto(repository.findById(id));
    },

    /**
     * Cambia el estado (RF-62). `actor` = { id, role }. Un developer solo puede cambiar el estado
     * de las tareas cuyo responsable es su miembro vinculado.
     */
    changeStatus(actor, id, to) {
      const task = requireTask(id);
      if (actor.role === 'developer') {
        const memberId = repository.memberOfUser(actor.id);
        if (memberId === null || task.assignee_id !== memberId) {
          throw AppError.forbidden('Solo puedes cambiar el estado de tus propias tareas');
        }
      } else if (!['admin', 'pm'].includes(actor.role)) {
        throw AppError.forbidden();
      }
      assertEditable(task);
      if (to === 'done') {
        const open = repository.subtasksOf(id).filter((s) => s.status !== 'done').length;
        if (open > 0) {
          throw AppError.businessRule(`La tarea tiene ${open} subtareas sin terminar`, {
            openSubtasks: open,
          });
        }
      }
      if (task.status !== to) {
        db.transaction(() => {
          applyStatus(task, to, actor.id);
          audit(actor.id, id, 'status_change', { status: [task.status, to] });
        })();
        snapshots?.recalculate([task.sprint_id]);
      }
      return toDto(repository.findById(id));
    },

    remove(actorId, id) {
      const before = requireTask(id);
      assertEditable(before);
      db.transaction(() => {
        repository.remove(id);
        audit(actorId, id, 'delete', { title: [before.title, null] });
      })();
      snapshots?.recalculate([before.sprint_id]);
    },
  };
}
