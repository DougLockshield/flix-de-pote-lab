import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { isPaidPlan, planById } from '../plans.js';
import { hashPassword, verifyPassword } from '../passwords.js';

const COOKIE = 'flix_session';
const DUMMY_HASH = hashPassword('pote-nao-usado');

export function isPremium(user) {
  if (!user || !isPaidPlan(user.plan) || !user.premium_until) return false;
  return new Date(user.premium_until).getTime() > Date.now();
}

export function publicUser(user) {
  const premium = isPremium(user);
  const plan = planById(user.plan);
  let accessStatus = 'free';
  if (user.plan !== 'free') accessStatus = premium ? 'ativo' : 'inativo';

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    planName: plan?.name || user.plan,
    isPremium: premium,
    premiumUntil: user.premium_until,
    accessStatus,
  };
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function tokenFrom(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }

  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function requireAuth(req, res, next) {
  const token = tokenFrom(req);
  if (!token) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return;
  }

  const user = req.app.locals.db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
  `).get(token);

  if (!user) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

export function createAuthRouter() {
  const router = Router();

  router.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Informe e-mail e senha.' });
      return;
    }
    if (email.length > 120 || password.length > 200) {
      res.status(400).json({ error: 'E-mail ou senha fora do tamanho aceito.' });
      return;
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
      token,
      user.id,
      new Date().toISOString(),
    );
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', requireAuth, (req, res) => {
    req.app.locals.db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = req.app.locals.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  });

  return router;
}
