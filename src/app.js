import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound } from './middlewares/notFound.js';
import { createErrorHandler } from './middlewares/errorHandler.js';
import { createLogger } from './lib/logger.js';
import { createEventBus } from './realtime/eventBus.js';
import { createSse } from './realtime/sse.js';
import { verifyOrigin } from './middlewares/verifyOrigin.js';
import { layout } from './middlewares/layout.js';
import { createSession } from './modules/auth/session.js';
import { createSettingsRouter } from './modules/settings/settings.routes.js';
import { createSettingsService } from './modules/settings/settings.service.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createBurndownRouter } from './modules/burndown/burndown.routes.js';
import { createGanttRouter } from './modules/gantt/gantt.routes.js';
import { createTimeEntriesRouter } from './modules/time-entries/time-entries.routes.js';
import { createTasksRouter } from './modules/tasks/tasks.routes.js';
import { createSprintsRouter } from './modules/sprints/sprints.routes.js';
import { createLoadRouter } from './modules/assignments/load.routes.js';
import { createClientsRouter } from './modules/clients/clients.routes.js';
import { createProjectsRouter } from './modules/projects/projects.routes.js';
import { createTeamRouter } from './modules/team/team.routes.js';
import { createUsersRouter } from './modules/auth/users.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fábrica de la aplicación Express (sin listen) para poder probarla.
 * @param {{ config: object, db?: object, logger?: object }} deps
 */
export function createApp({
  config,
  db = null,
  logger = createLogger(config),
  eventBus = createEventBus(),
  sseHeartbeatMs = 25_000,
}) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'src/views'));
  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      // «same-origin» (no «no-referrer»): el navegador envía Origin en los formularios propios
      // y verifyOrigin puede comprobarlo, sin filtrar el referrer a otros sitios.
      referrerPolicy: { policy: 'same-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Frappe Gantt/Chart.js aplican estilos en línea
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use(verifyOrigin);

  if (db) {
    const { middleware, store } = createSession({ config, db });
    app.locals.sessionStore = store;
    app.use(middleware);
    app.use((req, res, next) => {
      res.locals.currentUser = req.session?.userId
        ? { id: req.session.userId, fullName: req.session.fullName, role: req.session.role }
        : null;
      next();
    });
    app.use(createAuthRouter({ db, loginLimit: config.loginMaxAttempts }));
  }

  app.locals.appName = 'DevPM';
  app.locals.eventBus = eventBus;
  app.use(layout());

  if (db) {
    const sse = createSse({ eventBus, heartbeatMs: sseHeartbeatMs });
    app.locals.sse = sse;
    app.use(sse.router);
    app.use(createClientsRouter({ db, events: eventBus }));
    app.use(createTeamRouter({ db, events: eventBus }));
    app.use(createSprintsRouter({ db, timezone: config.timezone, events: eventBus }));
    app.use(createTasksRouter({ db, timezone: config.timezone, events: eventBus }));
    const settings = createSettingsService({ db, events: eventBus });
    app.use(createSettingsRouter({ settings }));
    app.use(
      createDashboardRouter({
        db,
        timezone: config.timezone,
        getThresholds: settings.getThresholds,
      }),
    );
    app.use(createBurndownRouter({ db, timezone: config.timezone }));
    app.use(createGanttRouter({ db, timezone: config.timezone }));
    app.use(createTimeEntriesRouter({ db, timezone: config.timezone, events: eventBus }));
    app.use(createLoadRouter({ db, timezone: config.timezone }));
    app.use(createProjectsRouter({ db, timezone: config.timezone, events: eventBus }));
    app.use(
      createUsersRouter({
        db,
        sessionStore: app.locals.sessionStore,
        bcryptCost: config.isTest ? 4 : 12,
      }),
    );
  }

  app.get('/health', (_req, res) => {
    let dbStatus = 'n/a';
    if (db) {
      try {
        db.prepare('SELECT 1').get();
        dbStatus = 'ok';
      } catch {
        dbStatus = 'error';
      }
    }
    res.status(dbStatus === 'error' ? 503 : 200).json({
      status: dbStatus === 'error' ? 'degraded' : 'ok',
      db: dbStatus,
      uptime: Math.round(process.uptime()),
    });
  });

  app.get('/', (_req, res) => {
    res.render('pages/home', { title: 'Inicio' });
  });

  app.use(notFound);
  app.use(createErrorHandler(logger));

  return app;
}
