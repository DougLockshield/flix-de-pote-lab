import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DB_PATH, HOST, PORT } from './config.js';
import { openDatabase } from './db.js';
import { createAuthRouter } from './modules/auth.js';
import { createCatalogRouter } from './modules/catalog.js';
import { createCouponRouter } from './modules/coupons.js';
import { createLabRouter } from './modules/lab.js';
import { createProfileRouter } from './modules/profiles.js';
import { createSubscriptionRouter } from './modules/subscriptions.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'",
    );
    next();
  });

  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/profile', createProfileRouter());
  app.use('/api/subscription', createSubscriptionRouter());
  app.use('/api/catalog', createCatalogRouter());
  app.use('/api/coupons', createCouponRouter());
  app.use('/api/lab', createLabRouter());
  app.use(express.static(publicDir, { dotfiles: 'deny', index: 'index.html' }));

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Recurso não encontrado.' });
      return;
    }
    res.status(404).type('text/plain; charset=utf-8').send('Não encontrado');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'JSON inválido.' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Erro interno.' });
  });

  return app;
}

export function startServer({ db, dbPath, port = PORT } = {}) {
  const database = db ?? openDatabase(dbPath ?? DB_PATH);
  const app = createApp(database);
  const server = app.listen(port, HOST);
  return { app, db: database, server };
}
