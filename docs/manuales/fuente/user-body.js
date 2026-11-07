  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.context().clearCookies();
  await page.goto(BASE + '/login'); await page.evaluate(() => localStorage.clear());
  await shot(page, 'u01-login', { url: '/login', marks: [{ css: '#email', n: 1 }, { css: '#password', n: 2 }, { css: 'button[type=submit]', n: 3 }, { css: 'a[href="/forgot-password"]', n: 4 }] });
  await shot(page, 'u28-recuperar', { url: '/forgot-password', prep: async (p) => { await p.fill('#email', 'dev@devpm.local'); await p.click('button:has-text("Enviar enlace")'); await p.waitForLoadState('networkidle'); }, marks: [{ css: '[role=status]', n: 1 }, { css: 'a[href="/login"]', n: 2 }] });
  await login(page, 'pm@devpm.local');
  await shot(page, 'u02-tablero', { url: '/dashboard', marks: [
    { css: 'aside nav', n: 1 }, { css: 'header a[href="/account/password"]', n: 2 }, { css: 'header button', text: 'Salir', n: 3 },
    { css: '#dashboard-filters', n: 4 }, { css: '#kpi-cards article', text: 'K3', n: 5 }, { css: '[data-live-status]', n: 6 }, { css: '[data-theme-choice="dark"]', n: 7 }, { css: '#global-search', n: 8 }, { css: '[data-notification-bell]', n: 9 } ] });
  await shot(page, 'u03-riesgo', { url: '/dashboard', scrollTo: '#risk-title', marks: [{ css: '#risk-list', n: 1 }, { css: '#hours-chart', n: 2 }, { css: '#velocity-chart', n: 3 }, { css: '#progress-chart', n: 4 }] });
  await shot(page, 'u04-proyectos', { url: '/projects', marks: [{ css: 'form[action="/projects"] input[name=q]', n: 1 }, { css: 'form[action="/projects"] select[name=status]', n: 2 }, { css: 'a[href="/projects/new"]', n: 3 }, { css: 'tbody tr:first-child a', n: 4 }] });
  await shot(page, 'u05-ficha', { url: '/projects/1', marks: [{ css: 'dl[aria-label="Resumen del proyecto"]', n: 1 }, { css: 'p:has(a[href$="/gantt"])', n: 2 }] });
  await shot(page, 'u06-equipo-hitos', { url: '/projects/1', scrollTo: '#milestones-title', marks: [{ css: '#milestones-title', n: 1 }, { css: '#assignments-title', n: 2 }] });
  await shot(page, 'u07-backlog', { url: '/projects/1/backlog', marks: [{ css: '#bf-q', n: 1 }, { css: 'tbody tr:first-child a', n: 2 }, { css: 'form[action$="/sprint"]', n: 3 }, { css: '#new-task-title', n: 4 }] });
  await shot(page, 'u08-sprints', { url: '/projects/1/sprints', marks: [{ css: 'tbody a', text: 'Tablero', n: 1 }, { css: 'tbody a', text: 'Burndown', n: 2 }, { css: 'button', text: 'Cerrar sprint', n: 3 }, { css: '#new-sprint-title', n: 4 }] });
  await shot(page, 'u09-kanban', { url: '/projects/1/sprints/2/board', marks: [{ css: '[data-status=todo]', n: 1 }, { css: '[data-status=in_progress] [data-task-id]', n: 2 }, { css: '[data-status=in_progress] select', n: 3 }, { css: '[data-live-status]', n: 4 }] });
  await shot(page, 'u10-tarea', { url: '/tasks/12', marks: [{ css: '#status', n: 1 }, { css: '#title', n: 2 }, { css: '#assigneeId', n: 3 }] });
  await shot(page, 'u11-tarea-detalle', { url: '/tasks/12', scrollTo: '#subtasks-title', marks: [{ css: '#subtasks-title', n: 1 }, { css: '#deps-title', n: 2 }, { css: '#history-title', n: 3 }] });
  await shot(page, 'u12-aprobaciones', { url: '/time/approvals', marks: [{ css: 'form[action$="/approve"] button', n: 1 }, { css: 'input[name=reason]', n: 2 }, { css: 'select[name=isBillable]', n: 3 }] });
  await shot(page, 'u13-gantt', { url: '/projects/1/gantt', marks: [{ css: '[data-view-mode=Week]', n: 1 }, { css: 'input[name=groupBy]', n: 2 }, { css: '.gantt-container', n: 3 }, { css: '[data-live-status]', n: 4 }], wait: 1200 });
  await shot(page, 'u14-burndown', { url: '/projects/1/sprints/2/burndown', marks: [{ css: '#burndown-metric', n: 1 }, { css: '#burndown-summary', n: 2 }, { css: '#burndown-chart', n: 3 }], wait: 1200 });
  await shot(page, 'u15-carga', { url: '/assignments/load', marks: [{ css: 'form[action="/assignments/load"]', n: 1 }, { css: 'td.text-red-700', n: 2 }] });
  await shot(page, 'u16-password', { url: '/account/password', marks: [{ css: '#currentPassword', n: 1 }, { css: '#newPassword', n: 2 }, { css: '#confirmPassword', n: 3 }] });
  await shot(page, 'u23-comentarios', { url: '/tasks/12', prep: async (p) => {
      await p.fill('#new-comment', '@dev@devpm.local ¿Puedes revisar este punto antes del viernes?');
      await p.click('button:has-text("Comentar")');
      await p.waitForLoadState('networkidle');
    }, scrollTo: '#comentarios', marks: [{ css: '#comentarios ul', n: 1 }, { css: '#new-comment', n: 2 }, { css: '#comentarios button', text: 'Comentar', n: 3 }, { css: '#comentarios p.text-xs', text: '@', n: 4 }] });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await page.request.post(BASE + '/api/v1/tasks/12/attachments?name=' + encodeURIComponent('diagrama-modelo.png'), { data: png, headers: { 'Content-Type': 'application/octet-stream' } });
  log.push('adjunto: ' + up.status());
  await shot(page, 'u24-adjuntos', { url: '/tasks/12', scrollTo: '#adjuntos', marks: [{ css: '#adjuntos ul', n: 1 }, { css: '[data-attachment-input]', n: 2 }, { css: '#adjuntos a', text: 'diagrama', n: 3 }] });
  await shot(page, 'u25-busqueda', { url: '/search?q=portal', marks: [{ css: '#search-q', n: 1 }, { css: '#group-projects', n: 2 }, { css: '#group-tasks', n: 3 }] });
  await shot(page, 'u26-filtros', { url: '/projects?status=active', prep: async (p) => { await p.click('[data-saved-filters="projects"] summary'); await p.fill('#sf-projects-name', 'Proyectos activos'); }, marks: [{ css: '[data-saved-filters="projects"] summary', n: 1 }, { css: '#sf-projects-name', n: 2 }, { css: '[data-saved-filters="projects"] form button', text: 'Guardar', n: 3 }] });
  await shot(page, 'u27-importar', { url: '/import', prep: async (p) => {
      await p.fill('#csv', 'tipo,nombre,departamento,razon_social,tarifa_hora\ninterno,Soporte TI,Tecnología,,\nexterno,Constructora Delta,,Constructora Delta SA,abc\ninterno,Sin departamento,,,');
      await p.click('button:has-text("Validar")');
      await p.waitForLoadState('networkidle');
    }, marks: [{ css: '#entity', n: 1 }, { css: '[data-import-template]', n: 2 }, { css: '#csv', n: 3 }, { css: 'button[value=validate]', n: 4 }, { css: '#result-title', n: 5 }] });
  await login(page, 'dev@devpm.local');
  await shot(page, 'u21-mi-dia', { url: '/', marks: [{ css: '#week-title', n: 1 }, { css: '#tasks-title', n: 2 }, { css: '#notif-title', n: 3 }, { css: '[data-notification-bell]', n: 4 }] });
  await shot(page, 'u22-notificaciones', { url: '/notifications', marks: [{ css: 'a[href="/account/notifications"]', n: 1 }, { css: '#notification-list li', n: 2 }, { css: 'form[action="/notifications/read-all"] button', n: 3 }] });
  await shot(page, 'u30-preferencias', { url: '/account/notifications', marks: [{ css: 'input[name=emailNotifications]', n: 1 }, { css: 'fieldset table', n: 2 }, { css: 'button[type=submit]', text: 'Guardar', n: 3 }] });
  await shot(page, 'u29-dos-pasos', { url: '/account/security', prep: async (p) => { await p.click('button:has-text("Activar dos pasos")'); await p.waitForLoadState('networkidle'); }, marks: [{ css: '[data-totp-secret]', n: 1 }, { css: '#enable-code', n: 2 }, { css: 'button', text: 'Activar', n: 3 }] });
  await shot(page, 'u17-hoja', { url: '/time', marks: [{ css: 'nav[aria-label=Semana]', n: 1 }, { css: 'table', n: 2 }, { css: '#new-entry-title', n: 3 }] });
  await shot(page, 'u18-registrar', { url: '/time', scrollTo: '#new-entry-title', prep: async (p) => {
      await p.selectOption('#projectId', { index: 1 });
      await p.fill('#hours', '3.5');
      await p.fill('#description', 'Revisión de pruebas de integración');
    }, marks: [{ css: '#projectId', n: 1 }, { css: '#taskId', n: 2 }, { css: '#workDate', n: 3 }, { css: '#hours', n: 4 }, { css: '#description', n: 5 }] });
  await page.click('button:has-text("Registrar horas")').catch(() => {});
  await page.waitForLoadState('networkidle');
  await shot(page, 'u19-enviar', { url: '/time', marks: [{ css: 'h2', text: 'Registros de la semana', n: 1 }, { css: 'button', text: 'Enviar semana', n: 2 }, { css: 'a', text: 'Aprobaciones pendientes', n: 3 }] });
  await login(page, 'viewer@devpm.local');
  await shot(page, 'u20-observador', { url: '/projects', marks: [{ css: 'aside nav', n: 1 }, { css: 'tbody a', text: 'Ver', n: 2 }] });
  return log;
