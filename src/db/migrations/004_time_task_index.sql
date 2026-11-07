-- 004_time_task_index: el avance de cada tarea en el Gantt suma sus horas (time_entries.task_id).
-- Sin este índice cada tarea recorría todos los registros de tiempo (p95 del Gantt: 538 ms con
-- 100 000 registros). Revisión de EXPLAIN QUERY PLAN de la Etapa 11.
CREATE INDEX ix_time_task ON time_entries(task_id) WHERE task_id IS NOT NULL;
