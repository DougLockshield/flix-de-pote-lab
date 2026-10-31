import { Router } from 'express';
import { formatPrice, isPaidPlan, isTestPayment, planById, publicPlans } from '../plans.js';
import { publicUser, requireAuth } from './auth.js';

function parseId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function publicOrder(order) {
  const plan = planById(order.plan);
  return {
    id: order.id,
    plan: order.plan,
    planName: plan?.name || order.plan,
    amountCents: order.amount_cents,
    priceLabel: formatPrice(order.amount_cents),
    status: order.status,
    createdAt: order.created_at,
    approvedAt: order.approved_at,
  };
}

function listOrders(db, userId) {
  return db.prepare(`
    SELECT id, plan, amount_cents, status, created_at, approved_at
    FROM orders
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(userId).map(publicOrder);
}

export function grantPlan(db, userId, planId, months) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const now = new Date();
  const currentEnd = user.premium_until ? new Date(user.premium_until) : null;
  const renewing = user.plan === planId && currentEnd && currentEnd > now;
  const until = new Date((renewing ? currentEnd : now).getTime());
  until.setUTCMonth(until.getUTCMonth() + months);

  db.prepare(`UPDATE users SET plan = ?, premium_until = ? WHERE id = ?`).run(
    planId,
    until.toISOString(),
    userId,
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function extendPremium(db, userId, months) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const planId = isPaidPlan(user.plan) ? user.plan : 'solo';
  return grantPlan(db, userId, planId, months);
}

export function addPremiumDays(db, userId, days) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const now = new Date();
  const currentEnd = user.premium_until ? new Date(user.premium_until) : null;
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  const until = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const planId = isPaidPlan(user.plan) ? user.plan : 'solo';
  db.prepare('UPDATE users SET plan = ?, premium_until = ? WHERE id = ?').run(
    planId,
    until.toISOString(),
    userId,
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function setFree(db, userId) {
  db.prepare(`UPDATE users SET plan = 'free', premium_until = NULL WHERE id = ?`).run(userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function createSubscriptionRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      user: publicUser(user),
      plans: publicPlans(),
      orders: listOrders(db, req.user.id),
    });
  });

  router.post('/free', (req, res) => {
    if (req.body?.plan && req.body.plan !== 'free') {
      res.status(400).json({ error: 'Este recurso só encerra a assinatura paga.' });
      return;
    }
    const user = setFree(req.app.locals.db, req.user.id);
    res.json({ user: publicUser(user) });
  });

  router.post('/orders', (req, res) => {
    const plan = planById(req.body?.plan);
    if (!plan || !plan.paid || plan.id === 'premium') {
      res.status(400).json({ error: 'Escolha Pote Solo, Pote Família ou Pote Ostentação.' });
      return;
    }

    const db = req.app.locals.db;
    const created = db.prepare(`
      INSERT INTO orders (user_id, plan, amount_cents, status, created_at, approved_at)
      VALUES (?, ?, ?, 'pendente', ?, NULL)
    `).run(req.user.id, plan.id, plan.priceCents, new Date().toISOString());

    const order = db.prepare(`
      SELECT id, plan, amount_cents, status, created_at, approved_at
      FROM orders
      WHERE id = ?
    `).get(Number(created.lastInsertRowid));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.status(201).json({ order: publicOrder(order), user: publicUser(user) });
  });

  router.post('/orders/:id/pay', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Pedido inválido.' });
      return;
    }
    if (!isTestPayment(req.body)) {
      res.status(400).json({ error: 'Pagamento de teste recusado. Use os dados de teste do checkout.' });
      return;
    }

    const db = req.app.locals.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const order = db.prepare(`
        SELECT id, user_id, plan, amount_cents, status, created_at, approved_at
        FROM orders
        WHERE id = ? AND user_id = ?
      `).get(id, req.user.id);

      if (!order) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Pedido não encontrado.' });
        return;
      }
      if (order.status !== 'pendente') {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Este pedido já foi aprovado.' });
        return;
      }

      const plan = planById(order.plan);
      if (!plan?.paid) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Este pedido não corresponde a um plano pago.' });
        return;
      }

      const approvedAt = new Date().toISOString();
      db.prepare(`UPDATE orders SET status = 'aprovado', approved_at = ? WHERE id = ?`).run(approvedAt, order.id);
      const user = grantPlan(db, req.user.id, plan.id, 1);
      db.exec('COMMIT');

      const saved = db.prepare(`
        SELECT id, plan, amount_cents, status, created_at, approved_at
        FROM orders
        WHERE id = ?
      `).get(order.id);
      res.json({ order: publicOrder(saved), user: publicUser(user) });
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* a transação já foi encerrada */
      }
      throw error;
    }
  });

  return router;
}
