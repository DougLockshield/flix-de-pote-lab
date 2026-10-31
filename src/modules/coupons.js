import { Router } from 'express';
import { publicUser, requireAuth } from './auth.js';
import { addPremiumDays } from './subscriptions.js';

const RACE_WINDOW_MS = 150;

export function raceConditionEnabled() {
  return process.env.LAB_RACE_CONDITION === 'true';
}

function listCoupons(db) {
  return db.prepare(`
    SELECT code, description, months, max_uses, uses
    FROM coupons
    ORDER BY code
  `).all().map((coupon) => ({
    code: coupon.code,
    description: coupon.description,
    months: coupon.months,
    remaining: Math.max(0, coupon.max_uses - coupon.uses),
  }));
}

function listRedemptions(db, userId) {
  return db.prepare(`
    SELECT code, redeemed_at AS redeemedAt
    FROM redemptions
    WHERE user_id = ?
    ORDER BY id
  `).all(userId);
}

function redeemCoupon(db, userId, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code || code.length > 40) {
    return { status: 400, body: { error: 'Informe o código do cupom.' } };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const coupon = db.prepare(`
      SELECT code, description, months, max_uses, uses
      FROM coupons
      WHERE code = ?
    `).get(code);

    if (!coupon) {
      db.exec('ROLLBACK');
      return { status: 404, body: { error: 'Cupom não encontrado.' } };
    }

    const already = db.prepare(`
      SELECT id FROM redemptions WHERE user_id = ? AND code = ?
    `).get(userId, code);
    if (already) {
      db.exec('ROLLBACK');
      return { status: 409, body: { error: 'Este cupom já foi resgatado nesta conta.' } };
    }

    const updated = db.prepare(`
      UPDATE coupons
      SET uses = uses + 1
      WHERE code = ? AND uses < max_uses
    `).run(code);
    if (updated.changes !== 1) {
      db.exec('ROLLBACK');
      return { status: 409, body: { error: 'Este cupom esgotou.' } };
    }

    db.prepare(`
      INSERT INTO redemptions (user_id, code, redeemed_at, lab)
      VALUES (?, ?, ?, 0)
    `).run(userId, code, new Date().toISOString());

    const user = addPremiumDays(db, userId, coupon.months * 30);
    db.exec('COMMIT');
    return {
      status: 200,
      body: {
        user: publicUser(user),
        coupon: {
          code: coupon.code,
          remaining: coupon.max_uses - (coupon.uses + 1),
        },
      },
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* a transação já foi encerrada */
    }
    if (String(error?.message || '').includes('UNIQUE')) {
      return { status: 409, body: { error: 'Este cupom já foi resgatado nesta conta.' } };
    }
    throw error;
  }
}

async function redeemCouponRacy(db, userId, code) {
  const coupon = db.prepare(`
    SELECT code, description, months, max_uses, uses
    FROM coupons
    WHERE code = ?
  `).get(code);

  if (!coupon) return { status: 404, body: { error: 'Cupom não encontrado.' } };
  if (coupon.uses >= coupon.max_uses) {
    return { status: 409, body: { error: 'Este cupom esgotou.' } };
  }

  await new Promise((resolve) => setTimeout(resolve, RACE_WINDOW_MS));

  db.prepare('UPDATE coupons SET uses = uses + 1 WHERE code = ?').run(code);
  db.prepare(`
    INSERT INTO redemptions (user_id, code, redeemed_at, lab)
    VALUES (?, ?, ?, 1)
  `).run(userId, code, new Date().toISOString());
  const user = addPremiumDays(db, userId, coupon.months * 30);
  const stored = db.prepare('SELECT uses FROM coupons WHERE code = ?').get(code);

  return {
    status: 200,
    body: {
      user: publicUser(user),
      coupon: {
        code: coupon.code,
        remaining: Math.max(0, coupon.max_uses - stored.uses),
      },
    },
  };
}

export function createCouponRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    res.json({
      coupons: listCoupons(db),
      redemptions: listRedemptions(db, req.user.id),
    });
  });

  router.post('/redeem', async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim().toUpperCase();
      if (!code || code.length > 40) {
        res.status(400).json({ error: 'Informe o código do cupom.' });
        return;
      }
      const result = raceConditionEnabled()
        ? await redeemCouponRacy(req.app.locals.db, req.user.id, code)
        : redeemCoupon(req.app.locals.db, req.user.id, code);
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
