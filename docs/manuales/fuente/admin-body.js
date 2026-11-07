  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.context().clearCookies();
  await page.goto(BASE + '/login'); await page.evaluate(() => localStorage.clear());
  await page.fill('#email', 'viewer@devpm.local'); await page.fill('#password', 'incorrecta-a-proposito'); await page.click('button:has-text("Entrar")'); // un intento fallido para la bitácora de seguridad
  await login(page, 'admin@devpm.local');
  await shot(page, 'a01-usuarios', { url: '/admin/users', marks: [{ css: '#q', n: 1 }, { css: '#status', n: 2 }, { css: 'a[href="/admin/users/new"]', n: 3 }, { css: 'tbody tr:first-child a', n: 4 }, { css: 'nav[aria-label="Administración"]', n: 5 }] });
  await shot(page, 'a02-usuario-nuevo', { url: '/admin/users/new', prep: async (p) => {
      await p.fill('#fullName', 'Marta Salinas'); await p.fill('#email', 'marta.salinas@empresa.com'); await p.selectOption('#role', 'developer'); await p.fill('#password', 'ClaveSegura2026'); },
    marks: [{ css: '#fullName', n: 1 }, { css: '#email', n: 2 }, { css: '#role', n: 3 }, { css: '#password', n: 4 }, { css: '#teamMemberId', n: 5 }] });
  await shot(page, 'a23-acceso-usuario', { url: '/admin/users/3', scrollTo: '#access-title', marks: [{ css: '#access-title', n: 1 }, { css: 'form[action$="/unlock"] button', n: 2 }] });
  await shot(page, 'a03-clientes-externos', { url: '/clients/external', marks: [{ css: 'a[href="/clients/external/new"]', n: 1 }, { css: 'tbody tr:first-child a', n: 2 }] });
  await shot(page, 'a04-cliente-nuevo', { url: '/clients/external/new', prep: async (p) => {
      await p.fill('#name', 'Constructora Delta'); await p.fill('#legalName', 'Constructora Delta SA de CV'); await p.fill('#taxId', 'CDE101010AB1'); await p.fill('#hourlyRate', '950'); await p.fill('#currency', 'MXN'); await p.fill('#contactName', 'Ing. Rosa Vega'); await p.fill('#contactEmail', 'rosa.vega@delta.example'); },
    marks: [{ css: '#name', n: 1 }, { css: '#legalName', n: 2 }, { css: '#hourlyRate', n: 3 }, { css: '#currency', n: 4 }, { css: '#contactName', n: 5 }] });
  await shot(page, 'a05-cliente-ficha', { url: '/clients/external/4', scrollTo: '#client-projects-title', marks: [{ css: '#client-projects-title', n: 1 }] });
  await shot(page, 'a06-equipo', { url: '/team', marks: [{ css: 'a[href="/team/new"]', n: 1 }, { css: 'tbody tr:first-child a', n: 2 }] });
  await shot(page, 'a07-miembro', { url: '/team/1', marks: [{ css: '#position', n: 1 }, { css: '#weeklyHours', n: 2 }, { css: '#hourlyCost', n: 3 }, { css: '#isActive', n: 4 }] });
  await shot(page, 'a08-habilidades-ausencias', { url: '/team/1', scrollTo: '#skills-title', marks: [{ css: '#skills-title', n: 1 }, { css: '#timeoff-title', n: 2 }] });
  await shot(page, 'a09-proyecto-nuevo', { url: '/projects/new', prep: async (p) => {
      await p.fill('#name', 'Sistema de inventarios'); await p.selectOption('#clientId', { index: 1 }); await p.fill('#startDate', '2026-12-01'); await p.fill('#endDate', '2027-03-31'); await p.fill('#budgetHours', '800'); },
    marks: [{ css: '#name', n: 1 }, { css: '#clientId', n: 2 }, { css: '#managerId', n: 3 }, { css: '#startDate', n: 4 }, { css: '#budgetHours', n: 5 }] });
  await shot(page, 'a10-estado', { url: '/projects/1', scrollTo: '#status-title', marks: [{ css: '#status-title', n: 1 }, { css: '#confirmOpenTasks', n: 2 }] });
  await shot(page, 'a11-asignar', { url: '/projects/1', scrollTo: '#assignments-title', marks: [{ css: '#asgMember', n: 1 }, { css: '#asgPct', n: 2 }, { css: '#asgStart', n: 3 }] });
  await shot(page, 'a12-matriz', { url: '/assignments/matrix', marks: [{ css: 'table', n: 1 }] });
  await shot(page, 'a13-tablero-admin', { url: '/dashboard', scrollTo: '#kpis-title', marks: [{ css: '#kpi-cards article', text: 'K14', n: 1 }] });
  await shot(page, 'a14-exportar', { url: '/time/approvals', scrollTo: 'form[action="/api/v1/time-entries/export.csv"]', marks: [{ css: 'form[action="/api/v1/time-entries/export.csv"]', n: 1 }, { css: '#exFilterName', n: 2 }] });
  await shot(page, 'a15-umbrales', { url: '/admin/settings/kpis', prep: async (p) => { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); }, marks: [{ css: 'form[action="/admin/settings/kpis"] button', n: 1 }, { css: 'form[action="/admin/settings/kpis/reset"] button', n: 2 }] });
  await shot(page, 'a16-tablero-oscuro', { url: '/dashboard', prep: async (p) => { await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(500); }, marks: [{ css: '[data-theme-choice="system"]', n: 1 }, { css: '[data-theme-choice="dark"]', n: 2 }] });
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, 'a17-preferencias', { url: '/account/notifications', marks: [{ css: 'input[name=emailNotifications]', n: 1 }, { css: 'fieldset table', n: 2 }, { css: 'button[type=submit]', text: 'Guardar', n: 3 }] });
  await shot(page, 'a18-mi-dia-admin', { url: '/', marks: [{ css: '#approvals-title', n: 1 }, { css: '#risk-title', n: 2 }, { css: '[data-notification-bell]', n: 3 }] });
  await shot(page, 'a19-importar', { url: '/import', prep: async (p) => {
      await p.selectOption('#entity', 'members');
      await p.fill('#csv', 'nombre,apellido,correo,puesto,nivel,horas_semana,costo_hora\nBeatriz,Luna,beatriz.luna@empresa.com,qa,mid,40,300\nDiego,Torres,diego.torres@empresa.com,chef,senior,40,350');
      await p.click('button:has-text("Validar")');
      await p.waitForLoadState('networkidle');
    }, marks: [{ css: '#entity', n: 1 }, { css: '#csv', n: 2 }, { css: 'button[value=validate]', n: 3 }, { css: '#result-title', n: 4 }] });
  await shot(page, 'a20-bitacora', { url: '/admin/audit', marks: [{ css: 'form[aria-label="Filtros de la bitácora"]', n: 1 }, { css: 'table', n: 2 }] });
  await shot(page, 'a21-seguridad', { url: '/admin/security', marks: [{ css: 'form[aria-label="Filtros de seguridad"]', n: 1 }, { css: 'table', n: 2 }] });
  await shot(page, 'a22-estado', { url: '/admin/status', marks: [{ css: '[data-status-alerts]', n: 1 }, { css: '[aria-labelledby="req-title"]', n: 2 }, { css: '[aria-labelledby="backup-title"]', n: 3 }] });
  await shot(page, 'a24-dos-pasos-admin', { url: '/account/security', marks: [{ css: '#state-title', n: 1 }, { css: 'form[action="/account/security/setup"] button', n: 2 }] });
  return log;
