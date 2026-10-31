import { Router } from 'express';
import { isPremium, requireAuth } from './auth.js';

export function matchReplaceEnabled() {
  return process.env.LAB_MATCH_REPLACE === 'true';
}

export function excessiveDataEnabled() {
  return process.env.LAB_EXCESSIVE_DATA === 'true';
}

const PUBLIC_MOVIE = `
  id, title, synopsis, year, genre,
  duration_min AS durationMin, tier, tone
`;

function parseId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function publishMovie(row) {
  const movie = {
    id: row.id,
    title: row.title,
    synopsis: row.synopsis,
    year: row.year,
    genre: row.genre,
    durationMin: row.durationMin,
    tier: row.tier,
    tone: row.tone,
  };
  if (excessiveDataEnabled() && row.tier === 'premium' && row.playback_token) {
    movie.stream = {
      token: row.playback_token,
      url: `/api/catalog/streams/${row.playback_token}`,
    };
  }
  return movie;
}

export function createCatalogRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    const movies = req.app.locals.db.prepare(`
      SELECT ${PUBLIC_MOVIE}, playback_token
      FROM movies
      ORDER BY id
    `).all();
    res.json({ movies: movies.map(publishMovie) });
  });

  router.get('/streams/:token', (req, res) => {
    if (!excessiveDataEnabled() || !/^pote-stream-[a-z0-9-]+$/.test(req.params.token)) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }

    const movie = req.app.locals.db.prepare(`
      SELECT ${PUBLIC_MOVIE}
      FROM movies
      WHERE playback_token = ?
    `).get(req.params.token);

    if (!movie) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }

    res.json({
      movie,
      playback: {
        granted: true,
        positionSec: 0,
        source: `labmedia://local/${req.params.token}`,
      },
    });
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Filme inválido.' });
      return;
    }

    const movie = req.app.locals.db.prepare(`
      SELECT ${PUBLIC_MOVIE}
      FROM movies
      WHERE id = ?
    `).get(id);

    if (!movie) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }
    if (movie.title === 'A Última Sessão') {
      const secret = req.app.locals.db.prepare('SELECT reel FROM lab_secret WHERE id = 1').get();
      if (secret?.reel) res.setHeader('X-Bobina', secret.reel);
    }
    res.json({ movie });
  });

  router.post('/:id/playback', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Filme inválido.' });
      return;
    }

    const movie = req.app.locals.db.prepare(`
      SELECT ${PUBLIC_MOVIE}
      FROM movies
      WHERE id = ?
    `).get(id);

    if (!movie) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }

    const user = req.app.locals.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (movie.tier === 'premium' && !matchReplaceEnabled() && !isPremium(user)) {
      res.status(403).json({ error: 'Este título faz parte do plano Premium.' });
      return;
    }

    res.json({
      movie,
      playback: { granted: true, positionSec: 0 },
    });
  });

  return router;
}
