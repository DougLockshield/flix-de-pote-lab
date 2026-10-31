import { once } from 'node:events';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_LINES } from '../src/modules/lab.js';
import { startServer } from '../src/app.js';
import { HOST } from '../src/config.js';
import { TEST_PAYMENT } from '../src/plans.js';
import {
  DEMO_FREE_EMAIL,
  DEMO_PASSWORD,
  DEMO_PREMIUM_EMAIL,
  SINGLE_USE_COUPON,
  WELCOME_COUPON,
  openDatabase,
} from '../src/db.js';

let serverGate = Promise.resolve();

async function withServer(fn) {
  const previous = serverGate;
  let release;
  serverGate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;

  const db = openDatabase(':memory:');
  const { server } = startServer({ db, port: 0 });
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ db, base, address });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    release();
  }
}

async function login(base, email, password = DEMO_PASSWORD) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  const cookie = (response.headers.getSetCookie?.() || []).map((item) => item.split(';')[0]).join('; ');
  return { status: response.status, body, cookie, setCookie: response.headers.getSetCookie?.() || [] };
}

function authHeaders(cookie, extra = {}) {
  return { 'Content-Type': 'application/json', Cookie: cookie, ...extra };
}

test('o servidor escuta apenas em 127.0.0.1', async () => {
  assert.equal(HOST, '127.0.0.1');
  await withServer(async ({ address }) => {
    assert.equal(address.address, '127.0.0.1');
  });
});

test('login, sessão e página inicial', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Flix de Pote/);
    assert.equal(/https?:\/\//.test(html), false);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

    const rejected = await login(base, DEMO_FREE_EMAIL, 'errada');
    assert.equal(rejected.status, 401);
    assert.equal(rejected.setCookie.length, 0);

    const session = await login(base, DEMO_FREE_EMAIL);
    assert.equal(session.status, 200);
    assert.equal(session.body.user.email, DEMO_FREE_EMAIL);
    assert.equal(session.body.user.isPremium, false);
    assert.equal(session.body.user.password_hash, undefined);
    assert.match(session.setCookie[0], /HttpOnly/i);
    assert.match(session.setCookie[0], /SameSite=Strict/i);

    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: session.cookie } });
    assert.equal(me.status, 200);
    const anon = await fetch(`${base}/api/auth/me`);
    assert.equal(anon.status, 401);
  });
});

test('catálogo não publica caminhos internos e a reprodução exige o plano', async () => {
  await withServer(async ({ db, base }) => {
    const secrets = db.prepare('SELECT storage_path FROM movies').all().map((row) => row.storage_path);
    assert.ok(secrets.some((item) => item.endsWith('.labmedia')));

    const free = await login(base, DEMO_FREE_EMAIL);
    const premium = await login(base, DEMO_PREMIUM_EMAIL);
    assert.equal(premium.body.user.plan, 'familia');
    assert.equal(premium.body.user.planName, 'Pote Família');
    assert.equal(premium.body.user.isPremium, true);

    const catalogResponse = await fetch(`${base}/api/catalog`, { headers: { Cookie: free.cookie } });
    const catalogText = await catalogResponse.text();
    const catalog = JSON.parse(catalogText);
    assert.equal(catalogResponse.status, 200);
    assert.equal(catalog.movies.length, 12);
    assert.equal(catalog.movies.filter((movie) => movie.tier === 'premium').length, 6);
    for (const secret of secrets) assert.equal(catalogText.includes(secret), false);
    assert.deepEqual(Object.keys(catalog.movies[0]).sort(), [
      'durationMin', 'genre', 'id', 'synopsis', 'tier', 'title', 'tone', 'year',
    ]);

    const hidden = await fetch(`${base}/vault/sinal-vermelho.labmedia`);
    assert.equal(hidden.status, 404);

    const premiumMovie = catalog.movies.find((movie) => movie.tier === 'premium');
    const freeMovie = catalog.movies.find((movie) => movie.tier === 'free');

    const blocked = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(free.cookie),
    });
    assert.equal(blocked.status, 403);

    const allowedFree = await fetch(`${base}/api/catalog/${freeMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(free.cookie),
    });
    const allowedFreeText = await allowedFree.text();
    assert.equal(allowedFree.status, 200);
    assert.equal(JSON.parse(allowedFreeText).playback.granted, true);
    for (const secret of secrets) assert.equal(allowedFreeText.includes(secret), false);

    const allowedPremium = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(premium.cookie),
    });
    assert.equal(allowedPremium.status, 200);

    const guest = await fetch(`${base}/api/catalog/${freeMovie.id}/playback`, { method: 'POST' });
    assert.equal(guest.status, 401);

    db.prepare('UPDATE users SET premium_until = ? WHERE email = ?').run(
      '2000-01-01T00:00:00.000Z',
      DEMO_PREMIUM_EMAIL,
    );
    const expired = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(premium.cookie),
    });
    assert.equal(expired.status, 403);
  });
});

test('perfil altera só o nome e o checkout aprova o plano pago', async () => {
  await withServer(async ({ db, base }) => {
    const session = await login(base, DEMO_FREE_EMAIL);
    const joao = await login(base, DEMO_PREMIUM_EMAIL);
    const rejected = await fetch(`${base}/api/profile`, {
      method: 'PATCH',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({
        name: 'Maria Alterada',
        plan: 'ostentacao',
        premiumUntil: '2099-01-01T00:00:00.000Z',
      }),
    });
    assert.equal(rejected.status, 400);

    const unchanged = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: session.cookie } })).json();
    assert.equal(unchanged.user.name, 'Maria Costa');
    assert.equal(unchanged.user.plan, 'free');
    assert.equal(unchanged.user.isPremium, false);

    const renamed = await fetch(`${base}/api/profile`, {
      method: 'PATCH',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ name: 'Maria Alterada' }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).user.name, 'Maria Alterada');

    const direct = await fetch(`${base}/api/subscription`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ plan: 'ostentacao' }),
    });
    assert.equal(direct.status, 404);
    const stillFree = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: session.cookie } })).json();
    assert.equal(stillFree.user.plan, 'free');

    const listed = await (await fetch(`${base}/api/subscription`, { headers: { Cookie: session.cookie } })).json();
    assert.deepEqual(listed.plans.map((plan) => [plan.id, plan.priceCents]), [
      ['free', 0],
      ['solo', 1890],
      ['familia', 2990],
      ['ostentacao', 4490],
    ]);

    const catalog = await (await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } })).json();
    const premiumMovie = catalog.movies.find((movie) => movie.tier === 'premium');
    const prices = { solo: 1890, familia: 2990, ostentacao: 4490 };

    for (const plan of ['solo', 'familia', 'ostentacao']) {
      const created = await fetch(`${base}/api/subscription/orders`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
        body: JSON.stringify({ plan }),
      });
      const createdBody = await created.json();
      assert.equal(created.status, 201);
      assert.equal(createdBody.order.status, 'pendente');
      assert.equal(createdBody.order.amountCents, prices[plan]);
      assert.notEqual(createdBody.user.plan, plan);

      const blocked = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
      });
      assert.equal(blocked.status, plan === 'solo' ? 403 : 200);

      const wrong = await fetch(`${base}/api/subscription/orders/${createdBody.order.id}/pay`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
        body: JSON.stringify({ ...TEST_PAYMENT, cvv: '000' }),
      });
      assert.equal(wrong.status, 400);
      const pending = db.prepare('SELECT status FROM orders WHERE id = ?').get(createdBody.order.id);
      assert.equal(pending.status, 'pendente');

      const stolen = await fetch(`${base}/api/subscription/orders/${createdBody.order.id}/pay`, {
        method: 'POST',
        headers: authHeaders(joao.cookie),
        body: JSON.stringify(TEST_PAYMENT),
      });
      assert.equal(stolen.status, 404);

      const paid = await fetch(`${base}/api/subscription/orders/${createdBody.order.id}/pay`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
        body: JSON.stringify({ ...TEST_PAYMENT, plan: 'ostentacao' }),
      });
      const paidBody = await paid.json();
      assert.equal(paid.status, 200);
      assert.equal(paidBody.order.status, 'aprovado');
      assert.equal(paidBody.user.plan, plan);
      assert.equal(paidBody.user.isPremium, true);
      assert.equal(paidBody.user.accessStatus, 'ativo');

      const allowed = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
      });
      assert.equal(allowed.status, 200);
    }

    const downgraded = await fetch(`${base}/api/subscription/free`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ plan: 'free' }),
    });
    assert.equal((await downgraded.json()).user.isPremium, false);
    const blockedAgain = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
    });
    assert.equal(blockedAgain.status, 403);

    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    db.prepare('UPDATE users SET plan = ?, premium_until = ? WHERE email = ?').run(
      'premium',
      future.toISOString(),
      DEMO_FREE_EMAIL,
    );
    const legacy = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
    });
    assert.equal(legacy.status, 200);
  });
});

test('excessive data só expõe o endereço interno no modo vulnerável', async () => {
  await withServer(async ({ db, base }) => {
    const previous = process.env.LAB_EXCESSIVE_DATA;
    delete process.env.LAB_EXCESSIVE_DATA;
    try {
      const session = await login(base, DEMO_FREE_EMAIL);
      const secrets = db.prepare('SELECT storage_path FROM movies').all().map((row) => row.storage_path);

      function storedPlan() {
        return db.prepare('SELECT plan, premium_until FROM users WHERE email = ?').get(DEMO_FREE_EMAIL);
      }

      const secureResponse = await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } });
      const secureText = await secureResponse.text();
      const secure = JSON.parse(secureText);
      const premiumMovie = secure.movies.find((movie) => movie.tier === 'premium');
      assert.equal(secure.movies.some((movie) => Object.hasOwn(movie, 'stream')), false);
      assert.equal(secureText.includes('playback_token'), false);
      assert.equal(secureText.includes('pote-stream-'), false);
      for (const secret of secrets) assert.equal(secureText.includes(secret), false);

      const hiddenStream = await fetch(`${base}/api/catalog/streams/pote-stream-sinal-vermelho`, {
        headers: { Cookie: session.cookie },
      });
      assert.equal(hiddenStream.status, 404);
      const blocked = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
      });
      assert.equal(blocked.status, 403);
      assert.equal(storedPlan().plan, 'free');
      assert.equal(storedPlan().premium_until, null);

      process.env.LAB_EXCESSIVE_DATA = 'true';
      const exposedResponse = await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } });
      const exposedText = await exposedResponse.text();
      const exposed = JSON.parse(exposedText);
      for (const secret of secrets) assert.equal(exposedText.includes(secret), false);
      assert.equal(exposedText.includes('playback_token'), false);

      for (const movie of exposed.movies.filter((item) => item.tier === 'free')) {
        assert.equal(Object.hasOwn(movie, 'stream'), false);
      }
      const premium = exposed.movies.filter((item) => item.tier === 'premium');
      assert.equal(premium.length, 6);
      for (const movie of premium) {
        assert.match(movie.stream.token, /^pote-stream-[a-z0-9-]+$/);
        assert.equal(movie.stream.url, `/api/catalog/streams/${movie.stream.token}`);
      }

      const detail = await fetch(`${base}/api/catalog/${premium[0].id}`, { headers: { Cookie: session.cookie } });
      assert.equal(Object.hasOwn((await detail.json()).movie, 'stream'), false);

      const played = await fetch(`${base}${premium[0].stream.url}`, { headers: { Cookie: session.cookie } });
      const playback = await played.json();
      assert.equal(played.status, 200);
      assert.equal(playback.playback.granted, true);
      assert.equal(playback.playback.source, `labmedia://local/${premium[0].stream.token}`);
      assert.equal(Object.hasOwn(playback.movie, 'stream'), false);
      assert.equal(storedPlan().plan, 'free');
      assert.equal(storedPlan().premium_until, null);

      const official = await fetch(`${base}/api/catalog/${premium[0].id}/playback`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
      });
      assert.equal(official.status, 403);

      const anonymous = await fetch(`${base}${premium[0].stream.url}`);
      assert.equal(anonymous.status, 401);
    } finally {
      if (previous === undefined) delete process.env.LAB_EXCESSIVE_DATA;
      else process.env.LAB_EXCESSIVE_DATA = previous;
    }
  });
});

test('match and replace não altera o plano e só libera a reprodução no modo vulnerável', async () => {
  await withServer(async ({ db, base }) => {
    const previous = process.env.LAB_MATCH_REPLACE;
    delete process.env.LAB_MATCH_REPLACE;
    try {
      const session = await login(base, DEMO_FREE_EMAIL);
      const catalog = await (await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } })).json();
      const premiumMovie = catalog.movies.find((movie) => movie.tier === 'premium');

      async function play() {
        return fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
          method: 'POST',
          headers: authHeaders(session.cookie),
        });
      }

      function storedPlan() {
        return db.prepare('SELECT plan, premium_until FROM users WHERE email = ?').get(DEMO_FREE_EMAIL);
      }

      function assertStillFree() {
        const stored = storedPlan();
        assert.equal(stored.plan, 'free');
        assert.equal(stored.premium_until, null);
      }

      const secure = await play();
      assert.equal(secure.status, 403);
      assertStillFree();

      process.env.LAB_MATCH_REPLACE = 'true';
      const rights = await (await fetch(`${base}/api/subscription`, { headers: { Cookie: session.cookie } })).json();
      assert.equal(rights.user.plan, 'free');
      assert.equal(rights.user.isPremium, false);

      const vulnerable = await play();
      assert.equal(vulnerable.status, 200);
      assert.equal((await vulnerable.json()).playback.granted, true);
      assertStillFree();

      const anonymous = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, { method: 'POST' });
      assert.equal(anonymous.status, 401);
    } finally {
      if (previous === undefined) delete process.env.LAB_MATCH_REPLACE;
      else process.env.LAB_MATCH_REPLACE = previous;
    }
  });
});

test('mass assignment do perfil só vale com LAB_MASS_ASSIGNMENT', async () => {
  const previous = process.env.LAB_MASS_ASSIGNMENT;
  delete process.env.LAB_MASS_ASSIGNMENT;
  try {
    await withServer(async ({ db, base }) => {
      const session = await login(base, DEMO_FREE_EMAIL);
      const catalog = await (await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } })).json();
      const premiumMovie = catalog.movies.find((movie) => movie.tier === 'premium');

      async function updateProfile(body, cookie = session.cookie) {
        const response = await fetch(`${base}/api/profile`, {
          method: 'PATCH',
          headers: authHeaders(cookie),
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }

      async function play() {
        const response = await fetch(`${base}/api/catalog/${premiumMovie.id}/playback`, {
          method: 'POST',
          headers: authHeaders(session.cookie),
        });
        return response.status;
      }

      const secure = await updateProfile({ name: 'Maria Costa', plan: 'familia' });
      assert.equal(secure.status, 400);
      assert.equal(db.prepare('SELECT plan FROM users WHERE email = ?').get(DEMO_FREE_EMAIL).plan, 'free');
      assert.equal(await play(), 403);

      process.env.LAB_MASS_ASSIGNMENT = 'true';

      const invalid = await updateProfile({ plan: 'premium' });
      assert.equal(invalid.status, 400);
      assert.equal(db.prepare('SELECT plan FROM users WHERE email = ?').get(DEMO_FREE_EMAIL).plan, 'free');

      const anonymous = await fetch(`${base}/api/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'ostentacao' }),
      });
      assert.equal(anonymous.status, 401);

      for (const plan of ['solo', 'familia', 'ostentacao']) {
        const assigned = await updateProfile({ plan });
        assert.equal(assigned.status, 200);
        assert.equal(assigned.body.user.plan, plan);
        assert.equal(assigned.body.user.isPremium, true);
        const stored = db.prepare('SELECT plan, premium_until FROM users WHERE email = ?').get(DEMO_FREE_EMAIL);
        assert.equal(stored.plan, plan);
        assert.ok(stored.premium_until);
        assert.equal(await play(), 200);
      }

      const renamed = await updateProfile({ name: 'Maria Lab', plan: 'solo' });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.user.name, 'Maria Lab');
      assert.equal(renamed.body.user.plan, 'solo');

      const downgraded = await updateProfile({ plan: 'free' });
      assert.equal(downgraded.status, 200);
      assert.equal(downgraded.body.user.plan, 'free');
      assert.equal(downgraded.body.user.isPremium, false);
      assert.equal(db.prepare('SELECT premium_until FROM users WHERE email = ?').get(DEMO_FREE_EMAIL).premium_until, null);
      assert.equal(await play(), 403);
    });
  } finally {
    if (previous === undefined) delete process.env.LAB_MASS_ASSIGNMENT;
    else process.env.LAB_MASS_ASSIGNMENT = previous;
  }
});

test('corrida do cupom único só passa no modo vulnerável e o reset limpa os dias', async () => {
  await withServer(async ({ db, base }) => {
    const previous = process.env.LAB_RACE_CONDITION;
    delete process.env.LAB_RACE_CONDITION;
    try {
      const session = await login(base, DEMO_FREE_EMAIL);

      async function burst() {
        return Promise.all(Array.from({ length: 8 }, () => fetch(`${base}/api/coupons/redeem`, {
          method: 'POST',
          headers: authHeaders(session.cookie),
          body: JSON.stringify({ code: SINGLE_USE_COUPON }),
        })));
      }

      function stored() {
        const user = db.prepare('SELECT plan, premium_until FROM users WHERE email = ?').get(DEMO_FREE_EMAIL);
        const uses = db.prepare('SELECT uses FROM coupons WHERE code = ?').get(SINGLE_USE_COUPON).uses;
        const redemptions = db.prepare('SELECT COUNT(*) AS total FROM redemptions WHERE code = ?').get(SINGLE_USE_COUPON).total;
        return { user, uses, redemptions };
      }

      const secureResponses = await burst();
      const secureStatuses = [];
      for (const response of secureResponses) secureStatuses.push(response.status);
      assert.equal(secureStatuses.filter((status) => status === 200).length, 1);
      const secure = stored();
      assert.equal(secure.uses, 1);
      assert.equal(secure.redemptions, 1);
      assert.equal(secure.user.plan, 'solo');
      const secureDays = (new Date(secure.user.premium_until).getTime() - Date.now()) / 86400000;
      assert.ok(secureDays > 29 && secureDays < 31);

      db.prepare('DELETE FROM redemptions').run();
      db.prepare('UPDATE coupons SET uses = 0').run();
      db.prepare(`UPDATE users SET plan = 'free', premium_until = NULL WHERE email = ?`).run(DEMO_FREE_EMAIL);

      process.env.LAB_RACE_CONDITION = 'true';
      const vulnerableResponses = await burst();
      const vulnerable = [];
      for (const response of vulnerableResponses) vulnerable.push(response.status);
      const accepted = vulnerable.filter((status) => status === 200).length;
      assert.ok(accepted >= 5, `resgates aceitos: ${accepted}`);
      const raced = stored();
      assert.equal(raced.uses, accepted);
      assert.equal(raced.redemptions, accepted);
      assert.equal(raced.user.plan, 'solo');
      const racedDays = (new Date(raced.user.premium_until).getTime() - Date.now()) / 86400000;
      assert.ok(racedDays > 30 * accepted - 1);
      assert.ok(racedDays < 30 * accepted + 1);

      const history = await (await fetch(`${base}/api/coupons`, { headers: { Cookie: session.cookie } })).json();
      assert.equal(history.redemptions.length, accepted);

      const reset = await fetch(`${base}/api/lab/reset`, {
        method: 'POST',
        headers: authHeaders(session.cookie),
      });
      assert.equal(reset.status, 200);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM redemptions').get().total, 0);
      assert.equal(db.prepare('SELECT uses FROM coupons WHERE code = ?').get(SINGLE_USE_COUPON).uses, 0);

      const restored = await login(base, DEMO_FREE_EMAIL);
      assert.equal(restored.body.user.plan, 'free');
      assert.equal(restored.body.user.isPremium, false);
      const after = await (await fetch(`${base}/api/coupons`, { headers: { Cookie: restored.cookie } })).json();
      assert.equal(after.redemptions.length, 0);
      assert.equal(after.coupons.find((coupon) => coupon.code === SINGLE_USE_COUPON).remaining, 1);
    } finally {
      if (previous === undefined) delete process.env.LAB_RACE_CONDITION;
      else process.env.LAB_RACE_CONDITION = previous;
    }
  });
});

test('cupom concede um mês uma única vez e o reset volta ao início', async () => {
  await withServer(async ({ db, base }) => {
    const session = await login(base, DEMO_FREE_EMAIL);
    const first = await fetch(`${base}/api/coupons/redeem`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ code: WELCOME_COUPON.toLowerCase() }),
    });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.user.isPremium, true);
    assert.equal(firstBody.coupon.remaining, 19);

    const second = await fetch(`${base}/api/coupons/redeem`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ code: WELCOME_COUPON }),
    });
    assert.equal(second.status, 409);

    const missing = await fetch(`${base}/api/coupons/redeem`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ code: 'NAOEXISTE' }),
    });
    assert.equal(missing.status, 404);

    const sample = db.prepare('SELECT password_hash FROM users LIMIT 1').get();
    const tokens = [];
    for (let index = 0; index < 6; index += 1) {
      const inserted = db.prepare(`
        INSERT INTO users (email, name, password_hash, plan, premium_until, created_at)
        VALUES (?, ?, ?, 'free', NULL, ?)
      `).run(`corrida${index}@pote.local`, `Corrida ${index}`, sample.password_hash, new Date().toISOString());
      const token = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
        token,
        Number(inserted.lastInsertRowid),
        new Date().toISOString(),
      );
      tokens.push(token);
    }

    const results = await Promise.all(tokens.map(async (token) => {
      const response = await fetch(`${base}/api/coupons/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: SINGLE_USE_COUPON }),
      });
      return response.status;
    }));
    assert.equal(results.filter((status) => status === 200).length, 1);
    assert.equal(db.prepare('SELECT uses FROM coupons WHERE code = ?').get(SINGLE_USE_COUPON).uses, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM redemptions WHERE code = ?').get(SINGLE_USE_COUPON).total, 1);

    const reset = await fetch(`${base}/api/lab/reset`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
    });
    assert.equal(reset.status, 200);
    const afterReset = await fetch(`${base}/api/auth/me`, { headers: { Cookie: session.cookie } });
    assert.equal(afterReset.status, 401);

    const restored = await login(base, DEMO_FREE_EMAIL);
    assert.equal(restored.body.user.name, 'Maria Costa');
    assert.equal(restored.body.user.isPremium, false);
    const coupons = await (await fetch(`${base}/api/coupons`, { headers: { Cookie: restored.cookie } })).json();
    const welcome = coupons.coupons.find((coupon) => coupon.code === WELCOME_COUPON);
    assert.equal(welcome.remaining, 20);
  });
});

test('a flag bônus é gerada, verificável e reiniciada com os dados', async () => {
  await withServer(async ({ db, base }) => {
    const secret = db.prepare('SELECT flag, reel FROM lab_secret WHERE id = 1').get();
    assert.match(secret.flag, /^FLAG\{[a-f0-9]{32}\}$/);
    assert.match(secret.reel, /^[a-f0-9]{16}$/);

    const session = await login(base, DEMO_FREE_EMAIL);
    const catalog = await (await fetch(`${base}/api/catalog`, { headers: { Cookie: session.cookie } })).json();
    const catalogText = JSON.stringify(catalog);
    assert.equal(catalogText.includes(secret.flag), false);
    assert.equal(catalogText.includes(secret.reel), false);

    const lastSession = catalog.movies.find((movie) => movie.title === 'A Última Sessão');
    const other = catalog.movies.find((movie) => movie.title !== 'A Última Sessão');
    const hinted = await fetch(`${base}/api/catalog/${lastSession.id}`, { headers: { Cookie: session.cookie } });
    assert.equal(hinted.headers.get('x-bobina'), secret.reel);
    assert.equal(JSON.stringify(await hinted.json()).includes(secret.flag), false);
    const plain = await fetch(`${base}/api/catalog/${other.id}`, { headers: { Cookie: session.cookie } });
    assert.equal(plain.headers.get('x-bobina'), null);

    const guest = await fetch(`${base}/api/lab/bobina/${secret.reel}`);
    assert.equal(guest.status, 401);
    const missed = await fetch(`${base}/api/lab/bobina/${'0'.repeat(16)}`, { headers: { Cookie: session.cookie } });
    assert.equal(missed.status, 404);

    const found = await fetch(`${base}/api/lab/bobina/${secret.reel}`, { headers: { Cookie: session.cookie } });
    assert.equal(found.status, 200);
    assert.equal((await found.json()).flag, secret.flag);

    const wrong = await fetch(`${base}/api/lab/session`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ code: 'FLAG{00000000000000000000000000000000}' }),
    });
    assert.equal(wrong.status, 404);

    const right = await fetch(`${base}/api/lab/session`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
      body: JSON.stringify({ code: secret.flag }),
    });
    const rightBody = await right.json();
    assert.equal(right.status, 200);
    assert.equal(rightBody.ok, true);
    assert.ok(SESSION_LINES.includes(rightBody.message));

    const reset = await fetch(`${base}/api/lab/reset`, {
      method: 'POST',
      headers: authHeaders(session.cookie),
    });
    assert.equal(reset.status, 200);
    const renewed = db.prepare('SELECT flag, reel FROM lab_secret WHERE id = 1').get();
    assert.notEqual(renewed.flag, secret.flag);
    assert.notEqual(renewed.reel, secret.reel);
    assert.match(renewed.flag, /^FLAG\{[a-f0-9]{32}\}$/);

    const again = await login(base, DEMO_FREE_EMAIL);
    const stale = await fetch(`${base}/api/lab/session`, {
      method: 'POST',
      headers: authHeaders(again.cookie),
      body: JSON.stringify({ code: secret.flag }),
    });
    assert.equal(stale.status, 404);
    const fresh = await fetch(`${base}/api/lab/bobina/${renewed.reel}`, { headers: { Cookie: again.cookie } });
    assert.equal((await fresh.json()).flag, renewed.flag);
  });
});

test('o código publicado não contém uma flag pronta', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const skip = new Set(['node_modules', 'data', 'private', 'test']);
  const hits = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|md|css|html|svg)$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      if (/FLAG\{[a-f0-9]{32}\}/.test(text)) hits.push(full);
    }
  }

  walk(root);
  assert.deepEqual(hits, []);
});
