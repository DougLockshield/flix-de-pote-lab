import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './passwords.js';

export const DEMO_PASSWORD = 'pipoca';
export const DEMO_FREE_EMAIL = 'maria.costa@pote.local';
export const DEMO_PREMIUM_EMAIL = 'joao.lima@pote.local';
export const WELCOME_COUPON = 'POTEBEMVINDO';
export const SINGLE_USE_COUPON = 'NOITEDECINEMA';

const MOVIES = [
  ['O Pote Perdido', 'Um cartógrafo acha um pote de barro cuja tampa desenha o mapa de uma cidade que ninguém visitou.', 2019, 'Aventura', 108, 'free', 'rose', 'vault/pote-perdido.labmedia'],
  ['Noite de Pipoca', 'Três vizinhos convertem a lavanderia do prédio em um cinema que só funciona depois da meia-noite.', 2021, 'Comédia', 96, 'free', 'brick', 'vault/noite-de-pipoca.labmedia'],
  ['Estação Norte', 'A maquinista do último turno decide completar a linha mesmo depois do aviso de fechamento.', 2018, 'Drama', 114, 'free', 'wine', 'vault/estacao-norte.labmedia'],
  ['Maré de Verão', 'Dois cozinheiros de quiosque dividem uma receita e a maré que apaga o cardápio toda tarde.', 2022, 'Romance', 101, 'free', 'ember', 'vault/mare-de-verao.labmedia'],
  ['Rota 47', 'Uma entregadora cruza o sertão para devolver uma película antes que a sessão da meia-noite comece.', 2020, 'Ação', 99, 'free', 'clay', 'vault/rota-47.labmedia'],
  ['Vidro Moído', 'Um soprador de vidro tenta reconstruir uma janela que continua inteira, embora a polícia diga o contrário.', 2015, 'Policial', 110, 'free', 'crimson', 'vault/vidro-moido.labmedia'],
  ['Sinal Vermelho', 'Os semáforos de uma cidade passam a seguir um horário que não foi publicado em lugar nenhum.', 2023, 'Suspense', 112, 'premium', 'rust', 'vault/sinal-vermelho.labmedia', 'pote-stream-sinal-vermelho'],
  ['A Última Sessão', 'O projecionista descobre que a bobina da noite descreve o que ainda vai acontecer na plateia.', 2017, 'Ficção', 121, 'premium', 'garnet', 'vault/a-ultima-sessao.labmedia', 'pote-stream-a-ultima-sessao'],
  ['Código de Sal', 'Uma arquivista encontra legendas que narram fatos ainda não registrados em nenhum boletim.', 2024, 'Thriller', 107, 'premium', 'rose', 'vault/codigo-de-sal.labmedia', 'pote-stream-codigo-de-sal'],
  ['Jardim de Concreto', 'Moradores mantêm um jardim no último andar de um estacionamento que oficialmente não existe.', 2016, 'Drama', 118, 'premium', 'brick', 'vault/jardim-de-concreto.labmedia', 'pote-stream-jardim-de-concreto'],
  ['Eclipse na Cozinha', 'O restaurante só abre durante eclipses, e o próximo simplesmente não aparece no calendário.', 2025, 'Comédia', 94, 'premium', 'wine', 'vault/eclipse-na-cozinha.labmedia', 'pote-stream-eclipse-na-cozinha'],
  ['Arquipélago Interno', 'Uma cartógrafa mapeia ilhas que surgem apenas na memória de quem afirma ter viajado.', 2026, 'Aventura', 128, 'premium', 'ember', 'vault/arquipelago-interno.labmedia', 'pote-stream-arquipelago-interno'],
];

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL CHECK (plan IN ('free', 'solo', 'familia', 'ostentacao', 'premium')) DEFAULT 'free',
      premium_until TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      synopsis TEXT NOT NULL,
      year INTEGER NOT NULL,
      genre TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('free', 'premium')),
      tone TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      playback_token TEXT
    );

    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      months INTEGER NOT NULL,
      max_uses INTEGER NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL REFERENCES coupons(code),
      redeemed_at TEXT NOT NULL,
      lab INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pendente', 'aprovado')),
      created_at TEXT NOT NULL,
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lab_secret (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      flag TEXT NOT NULL,
      reel TEXT NOT NULL
    );
  `);
  ensurePlanConstraint(db);
  ensurePlaybackTokens(db);
  ensureRedemptionLedger(db);
  db.prepare('UPDATE coupons SET description = ? WHERE code = ?').run(
    '30 dias de acesso Premium, com um único resgate no laboratório.',
    SINGLE_USE_COUPON,
  );
}

function ensureRedemptionLedger(db) {
  const columns = db.prepare('PRAGMA table_info(redemptions)').all();
  if (!columns.some((column) => column.name === 'lab')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE redemptions_next (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL REFERENCES coupons(code),
        redeemed_at TEXT NOT NULL,
        lab INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO redemptions_next (id, user_id, code, redeemed_at, lab)
      SELECT id, user_id, code, redeemed_at, 0 FROM redemptions;
      DROP TABLE redemptions;
      ALTER TABLE redemptions_next RENAME TO redemptions;
    `);
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS redemptions_user_code_once
    ON redemptions(user_id, code) WHERE lab = 0
  `);
}

function ensurePlaybackTokens(db) {
  const columns = db.prepare('PRAGMA table_info(movies)').all();
  if (!columns.some((column) => column.name === 'playback_token')) {
    db.exec('ALTER TABLE movies ADD COLUMN playback_token TEXT');
  }
  const update = db.prepare(`
    UPDATE movies
    SET playback_token = ?
    WHERE title = ? AND playback_token IS NULL
  `);
  for (const movie of MOVIES) {
    if (movie[8]) update.run(movie[8], movie[0]);
  }
}

function ensurePlanConstraint(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row || String(row.sql).includes("'ostentacao'")) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_next (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL CHECK (plan IN ('free', 'solo', 'familia', 'ostentacao', 'premium')) DEFAULT 'free',
      premium_until TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO users_next (id, email, name, password_hash, plan, premium_until, created_at)
    SELECT id, email, name, password_hash,
      CASE plan WHEN 'premium' THEN 'familia' ELSE plan END,
      premium_until, created_at
    FROM users;
    DROP TABLE users;
    ALTER TABLE users_next RENAME TO users;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

function seed(db) {
  const now = new Date();
  const premiumUntil = new Date(now.getTime());
  premiumUntil.setUTCDate(premiumUntil.getUTCDate() + 30);
  const createdAt = now.toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  const insertUser = db.prepare(`
    INSERT INTO users (email, name, password_hash, plan, premium_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertUser.run(DEMO_FREE_EMAIL, 'Maria Costa', passwordHash, 'free', null, createdAt);
  insertUser.run(DEMO_PREMIUM_EMAIL, 'João Lima', passwordHash, 'familia', premiumUntil.toISOString(), createdAt);

  const insertMovie = db.prepare(`
    INSERT INTO movies (title, synopsis, year, genre, duration_min, tier, tone, storage_path, playback_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const movie of MOVIES) insertMovie.run(...movie.slice(0, 8), movie[8] ?? null);

  const insertCoupon = db.prepare(`
    INSERT INTO coupons (code, description, months, max_uses, uses)
    VALUES (?, ?, ?, ?, 0)
  `);
  insertCoupon.run(WELCOME_COUPON, 'Um mês de acesso à coleção Premium.', 1, 20);
  insertCoupon.run(SINGLE_USE_COUPON, '30 dias de acesso Premium, com um único resgate no laboratório.', 1, 1);
  insertLabSecret(db);
}

function insertLabSecret(db) {
  const flag = `FLAG{${randomBytes(16).toString('hex')}}`;
  const reel = randomBytes(8).toString('hex');
  db.prepare('INSERT INTO lab_secret (id, flag, reel) VALUES (1, ?, ?)').run(flag, reel);
}

export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') {
    mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.enableDefensive(true);
  db.exec('PRAGMA foreign_keys = ON');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);

  const row = db.prepare('SELECT COUNT(*) AS total FROM users').get();
  if (row.total === 0) seed(db);
  else if (!db.prepare('SELECT id FROM lab_secret WHERE id = 1').get()) insertLabSecret(db);
  return db;
}

export function resetDatabase(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      DELETE FROM redemptions;
      DELETE FROM sessions;
      DELETE FROM orders;
      DELETE FROM coupons;
      DELETE FROM movies;
      DELETE FROM users;
      DELETE FROM lab_secret;
    `);
    seed(db);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* a transação já foi encerrada */
    }
    throw error;
  }
}
