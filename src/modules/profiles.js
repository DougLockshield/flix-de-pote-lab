import { Router } from 'express';
import { publicUser, requireAuth } from './auth.js';
import { grantPlan, setFree } from './subscriptions.js';

const ASSIGNABLE_PLANS = new Set(['free', 'solo', 'familia', 'ostentacao']);

export function massAssignmentEnabled() {
  return process.env.LAB_MASS_ASSIGNMENT === 'true';
}

export function createProfileRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    const user = req.app.locals.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  });

  router.patch('/', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Envie um objeto JSON com o campo name.' });
      return;
    }

    const allowed = new Set(['name']);
    if (massAssignmentEnabled()) allowed.add('plan');

    const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      res.status(400).json({
        error: 'Apenas o nome pode ser alterado aqui. O plano muda na página de assinatura.',
      });
      return;
    }

    const hasName = Object.hasOwn(body, 'name');
    const hasPlan = Object.hasOwn(body, 'plan');
    if (!hasName && !hasPlan) {
      res.status(400).json({ error: 'Envie um objeto JSON com o campo name.' });
      return;
    }

    let name = '';
    if (hasName) {
      name = String(body.name ?? '').trim();
      if (name.length < 2 || name.length > 80 || /[\u0000-\u001F]/.test(name)) {
        res.status(400).json({ error: 'Informe um nome com 2 a 80 caracteres.' });
        return;
      }
    }

    if (hasPlan && !ASSIGNABLE_PLANS.has(body.plan)) {
      res.status(400).json({ error: 'Plano inválido. Use free, solo, familia ou ostentacao.' });
      return;
    }

    const db = req.app.locals.db;
    if (hasName) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    if (hasPlan) {
      if (body.plan === 'free') setFree(db, req.user.id);
      else grantPlan(db, req.user.id, body.plan, 1);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  });

  return router;
}
