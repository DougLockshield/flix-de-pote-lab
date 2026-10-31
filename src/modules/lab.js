import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { resetDatabase } from '../db.js';
import { clearSessionCookie, requireAuth } from './auth.js';

export const SESSION_LINES = [
  'O kernel agradece. A pipoca, nem tanto.',
  'Premium liberado no coração, não no banco.',
  'Você furou a fila da sessão da meia-noite.',
  'Hacker de pote: raiz encontrada, manteiga opcional.',
  'Assinatura vitalícia de pipoca imaginária concedida.',
  'O proxy pediu mais manteiga.',
  'Root na pipoqueira. Sem sudo.',
  'Sua sessão expirou, mas a piada não.',
];

function sameSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function createLabRouter() {
  const router = Router();

  router.post('/reset', requireAuth, (req, res) => {
    resetDatabase(req.app.locals.db);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true, message: 'Dados do laboratório restaurados.' });
  });

  router.get('/bobina/:reel', requireAuth, (req, res) => {
    const secret = req.app.locals.db.prepare('SELECT flag, reel FROM lab_secret WHERE id = 1').get();
    if (!secret || !sameSecret(secret.reel, req.params.reel)) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }
    res.json({ flag: secret.flag });
  });

  router.post('/session', requireAuth, (req, res) => {
    const secret = req.app.locals.db.prepare('SELECT flag FROM lab_secret WHERE id = 1').get();
    const code = String(req.body?.code || '').trim();
    if (!secret || !sameSecret(secret.flag, code)) {
      res.status(404).json({ error: 'Código desconhecido.' });
      return;
    }
    const message = SESSION_LINES[Math.floor(Math.random() * SESSION_LINES.length)];
    res.json({ ok: true, message });
  });

  return router;
}
