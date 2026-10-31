const state = {
  user: null,
  movies: [],
  coupons: [],
  redemptions: [],
  plans: [],
  orders: [],
  checkout: null,
  view: 'catalog',
  notice: null,
  player: null,
};

let locked = false;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

function premiumDays(user) {
  if (!user?.premiumUntil) return 0;
  const remaining = new Date(user.premiumUntil).getTime() - Date.now();
  if (remaining <= 0) return 0;
  return Math.round(remaining / 86400000);
}

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
  } catch {
    const error = new Error('Não foi possível falar com o servidor.');
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a ação.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function run(task) {
  if (locked) return;
  locked = true;
  try {
    await task();
  } finally {
    locked = false;
  }
}

function noticeHtml() {
  if (!state.notice) return '';
  const kind = state.notice.type === 'error' ? 'is-error' : 'is-ok';
  const role = state.notice.type === 'error' ? 'alert' : 'status';
  return `<p id="notice" class="notice ${kind}" role="${role}">${esc(state.notice.text)}</p>`;
}

const POSTERS = {
  'O Pote Perdido': '/posters/pote-perdido.jpg',
  'Noite de Pipoca': '/posters/noite-de-pipoca.jpg',
  'Estação Norte': '/posters/estacao-norte.jpg',
  'Maré de Verão': '/posters/mare-de-verao.jpg',
  'Rota 47': '/posters/rota-47.jpg',
  'Vidro Moído': '/posters/vidro-moido.jpg',
  'Sinal Vermelho': '/posters/sinal-vermelho.jpg',
  'A Última Sessão': '/posters/a-ultima-sessao.jpg',
  'Código de Sal': '/posters/codigo-de-sal.jpg',
  'Jardim de Concreto': '/posters/jardim-de-concreto.jpg',
  'Eclipse na Cozinha': '/posters/eclipse-na-cozinha.jpg',
  'Arquipélago Interno': '/posters/arquipelago-interno.jpg',
};

function posterImg(movie) {
  const src = POSTERS[movie?.title];
  if (!src) return '';
  return `<img src="${esc(src)}" alt="">`;
}

function movieCard(movie) {
  const tierClass = movie.tier === 'premium' ? 'is-premium' : 'is-free';
  const tierLabel = movie.tier === 'premium' ? 'Premium' : 'Free';
  const locked = movie.tier === 'premium' && !state.user?.isPremium;
  const play = locked
    ? '<button class="primary" type="button" disabled>Premium</button>'
    : `<button class="primary" type="button" data-action="play" data-id="${Number(movie.id)}">Assistir</button>`;
  return `
    <article class="card${locked ? ' is-locked' : ''}">
      <div class="poster" data-tone="${esc(movie.tone)}">
        ${posterImg(movie)}
        <span class="kicker">${esc(movie.genre)}</span>
        <h3>${esc(movie.title)}</h3>
      </div>
      <div class="card-body">
        <p class="meta">${esc(movie.year)} · ${esc(formatDuration(movie.durationMin))}</p>
        <p class="tier ${tierClass}">${tierLabel}</p>
        ${play}
      </div>
    </article>
  `;
}

function row(title, movies) {
  if (!movies.length) return '';
  return `
    <section class="row">
      <h2>${esc(title)}</h2>
      <div class="track">${movies.map(movieCard).join('')}</div>
    </section>
  `;
}

function playerHtml() {
  if (!state.player) return '';
  if (state.player.denied) {
    return `
      <div class="overlay" id="player">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="player-title">
          <h2 id="player-title">Título bloqueado</h2>
          <p>${esc(state.player.message)}</p>
          <div class="dialog-actions">
            <button class="primary" type="button" data-action="view" data-view="plans">Ver assinatura</button>
            <button class="ghost" type="button" data-action="close-player">Fechar</button>
          </div>
        </div>
      </div>
    `;
  }

  const movie = state.player.movie;
  return `
    <div class="overlay" id="player">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="player-title">
        <div class="screen" data-tone="${esc(movie.tone)}" aria-hidden="true">
          ${posterImg(movie)}
          <div class="progress"><span></span></div>
        </div>
        <p class="granted">Reprodução autorizada pelo servidor</p>
        <h2 id="player-title">${esc(movie.title)}</h2>
        <p>${esc(movie.synopsis)}</p>
        <p class="meta">${esc(movie.year)} · ${esc(formatDuration(movie.durationMin))}</p>
        <div class="dialog-actions">
          <button class="ghost" type="button" data-action="close-player">Fechar</button>
        </div>
      </div>
    </div>
  `;
}

function catalogHtml() {
  const featured = state.movies.find((movie) => movie.tier === 'free') || state.movies[0];
  const free = state.movies.filter((movie) => movie.tier === 'free');
  const premium = state.movies.filter((movie) => movie.tier === 'premium');
  const hero = featured
    ? `
      <section class="hero">
        <div>
          <p class="kicker">${esc(featured.genre)} · ${featured.tier === 'premium' ? 'Premium' : 'Free'}</p>
          <h1>${esc(featured.title)}</h1>
          <p class="lede">${esc(featured.synopsis)}</p>
          <button class="primary" type="button" data-action="play" data-id="${Number(featured.id)}">Assistir</button>
        </div>
        ${posterImg(featured)}
      </section>
    `
    : '<p class="muted">Nenhum filme no catálogo.</p>';

  return `
    ${hero}
    ${row('Para começar', free)}
    ${row('Coleção Premium', premium)}
  `;
}

function profileHtml() {
  const user = state.user;
  return `
    <section class="stack" id="profile">
      <h1>Perfil</h1>
      <p class="lede">O nome pode ser editado. E-mail e plano ficam de fora deste formulário.</p>
      <form id="profile-form" data-form="profile">
        <label for="profile-name">Nome</label>
        <input id="profile-name" name="name" value="${esc(user.name)}" maxlength="80" required>
        <button class="primary" type="submit">Salvar nome</button>
      </form>
      <div class="profile-grid">
        <article class="panel">
          <h2>Conta</h2>
          <p>${esc(user.email)}</p>
        </article>
        <article class="panel">
          <h2>Acesso</h2>
          <p>Plano: ${esc(user.planName)}</p>
          <p>Status: ${esc(accessLabel(user))}</p>
        </article>
      </div>
      <form id="session-form" data-form="session" class="session-form">
        <label for="session-code">Código da sessão</label>
        <input id="session-code" name="code" maxlength="80" autocomplete="off">
        <button class="ghost" type="submit">Enviar</button>
      </form>
    </section>
  `;
}

function accessLabel(user) {
  if (user.accessStatus === 'ativo') return `ativo até ${formatDate(user.premiumUntil)}`;
  if (user.accessStatus === 'inativo') return 'inativo';
  return 'Free';
}

function plansHtml() {
  const current = state.user.plan;
  const cards = state.plans.map((plan) => {
    const isCurrent = plan.id === current;
    const featured = plan.id === 'ostentacao' ? ' is-featured' : '';
    let action = '';
    if (plan.paid) {
      const label = isCurrent ? 'Renovar' : 'Assinar';
      action = `<button class="primary" type="button" data-action="checkout" data-plan="${esc(plan.id)}">${label}</button>`;
    } else if (isCurrent) {
      action = '<button class="ghost" type="button" disabled>Plano atual</button>';
    } else {
      action = '<button class="ghost" type="button" data-action="downgrade">Mudar para Free</button>';
    }
    const benefits = plan.benefits.map((item) => `<li>${esc(item)}</li>`).join('');
    return `
      <article class="plan-card${isCurrent ? ' is-current' : ''}${featured}">
        ${isCurrent ? '<p class="plan-flag">Plano atual</p>' : '<p class="plan-flag">&nbsp;</p>'}
        <h2>${esc(plan.name)}</h2>
        <p class="plan-price">${esc(plan.priceLabel)}<span>/mês</span></p>
        <p class="muted">${esc(plan.tagline)}</p>
        <ul>${benefits}</ul>
        ${action}
      </article>
    `;
  }).join('');

  const compareRows = [
    ['Coleção Premium', (plan) => (plan.paid ? 'Sim' : 'Não')],
    ['Telas', (plan) => plan.screens],
    ['Qualidade', (plan) => plan.quality],
    ['Estreias fictícias', (plan) => (plan.premieres ? 'Primeiro' : 'Não')],
  ].map(([label, cell]) => `
    <tr>
      <th scope="row">${label}</th>
      ${state.plans.map((plan) => `<td>${esc(cell(plan))}</td>`).join('')}
    </tr>
  `).join('');

  const coupons = state.coupons.map((coupon) => `
    <li>
      <div>
        <code>${esc(coupon.code)}</code>
        <p>${esc(coupon.description)} · ${coupon.remaining} restante(s)</p>
      </div>
      <button class="ghost" type="button" data-action="redeem" data-code="${esc(coupon.code)}" ${coupon.remaining < 1 ? 'disabled' : ''}>Resgatar</button>
    </li>
  `).join('');

  const orders = state.orders.length
    ? state.orders.map((order) => `
      <li>
        <span>Pedido ${order.id} · ${esc(order.planName)} · ${esc(order.priceLabel)}</span>
        <strong class="order-status">${esc(order.status)}</strong>
      </li>
    `).join('')
    : '<li><span class="muted">Nenhum pedido ainda.</span></li>';

  return `
    <section id="plans">
      <h1>Assinatura</h1>
      <p class="lede">Planos fictícios. O pago só entra depois da aprovação no checkout de teste.</p>
      <p class="status-line">Plano atual: <strong>${esc(state.user.planName)}</strong> · status ${esc(accessLabel(state.user))} · dias Premium acumulados: <strong>${premiumDays(state.user)}</strong></p>
      <div class="plan-grid">${cards}</div>
      <div class="compare-wrap">
        <table class="compare">
          <caption>Comparação dos planos</caption>
          <thead>
            <tr>
              <th scope="col">Recurso</th>
              ${state.plans.map((plan) => `<th scope="col">${esc(plan.name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${compareRows}</tbody>
        </table>
      </div>
      <div class="plans-extra">
        <article class="panel">
          <h2>Pedidos</h2>
          <ul class="order-list">${orders}</ul>
        </article>
        <article class="panel">
          <h2>Cupons</h2>
          <p class="muted">Códigos fictícios. Cada cupom só pode ser resgatado uma vez por conta, dentro do limite do laboratório.</p>
          <form id="coupon-form" data-form="coupon">
            <label for="coupon-code">Código</label>
            <input id="coupon-code" name="code" maxlength="40" autocomplete="off" placeholder="POTEBEMVINDO">
            <button class="primary" type="submit">Resgatar código</button>
          </form>
          <ul class="coupon-list">${coupons}</ul>
          <h3>Histórico de resgates</h3>
          <ul class="order-list">${redemptionHistory()}</ul>
        </article>
      </div>
    </section>
  `;
}

function redemptionHistory() {
  if (!state.redemptions.length) {
    return '<li><span class="muted">Nenhum resgate ainda.</span></li>';
  }
  return state.redemptions.map((entry) => `
    <li>
      <span><code>${esc(entry.code)}</code> · ${esc(formatDateTime(entry.redeemedAt))}</span>
    </li>
  `).join('');
}

function checkoutHtml() {
  const order = state.checkout;
  if (!order) {
    return `
      <section id="checkout">
        <h1>Checkout</h1>
        <p class="lede">Escolha um plano pago para abrir o resumo.</p>
        <button class="ghost" type="button" data-action="view" data-view="plans">Voltar aos planos</button>
      </section>
    `;
  }

  return `
    <section id="checkout">
      <h1>Checkout</h1>
      <p class="lede">Pagamento simulado neste laboratório. Nenhum valor é cobrado e nenhum dado sai da sua máquina.</p>
      <div class="checkout-grid">
        <article class="panel summary">
          <p class="kicker">Resumo</p>
          <h2>${esc(order.planName)}</h2>
          <p class="plan-price">${esc(order.priceLabel)}<span>/mês</span></p>
          <p>Período: 1 mês</p>
          <p>Pedido ${order.id}</p>
          <p>Status: <strong>${esc(order.status)}</strong></p>
        </article>
        <form id="checkout-form" class="panel" data-form="checkout">
          <h2>Dados de teste</h2>
          <label for="holder">Titular</label>
          <input id="holder" name="holder" autocomplete="off" maxlength="80" required>
          <label for="card-number">Número</label>
          <input id="card-number" name="number" inputmode="numeric" autocomplete="off" maxlength="19" required>
          <div class="card-row">
            <div>
              <label for="expiry">Validade</label>
              <input id="expiry" name="expiry" autocomplete="off" maxlength="5" placeholder="MM/AA" required>
            </div>
            <div>
              <label for="cvv">CVV</label>
              <input id="cvv" name="cvv" inputmode="numeric" autocomplete="off" maxlength="4" required>
            </div>
          </div>
          <aside class="demo">
            <p>Use somente estes dados de teste</p>
            <p>Titular: Maria Costa</p>
            <p>Número: 4242 4242 4242 4242</p>
            <p>Validade: 12/30 · CVV: 123</p>
          </aside>
          <button class="primary" type="submit">Aprovar pagamento de teste</button>
          <button class="ghost" type="button" data-action="view" data-view="plans">Voltar aos planos</button>
        </form>
      </div>
    </section>
  `;
}

function shellHtml() {
  const planLabel = state.user.planName || 'Free';
  let content = catalogHtml();
  if (state.view === 'profile') content = profileHtml();
  if (state.view === 'plans') content = plansHtml();
  if (state.view === 'checkout') content = checkoutHtml();

  return `
    <header class="topbar">
      <button class="wordmark" type="button" data-action="view" data-view="catalog">Flix <em>de Pote</em></button>
      <nav aria-label="Seções">
        <button class="ghost" type="button" data-action="view" data-view="catalog" ${state.view === 'catalog' ? 'aria-current="page"' : ''}>Início</button>
        <button class="ghost" type="button" data-action="view" data-view="plans" ${state.view === 'plans' || state.view === 'checkout' ? 'aria-current="page"' : ''}>Assinatura</button>
        <button class="ghost" type="button" data-action="view" data-view="profile" ${state.view === 'profile' ? 'aria-current="page"' : ''}>Perfil</button>
      </nav>
      <div class="account">
        <span class="who">${esc(state.user.name)} · ${planLabel}</span>
        <button class="ghost" id="reset-lab" type="button" data-action="reset">Restaurar dados</button>
        <button class="ghost" type="button" data-action="logout">Sair</button>
      </div>
    </header>
    <main id="main">
      ${noticeHtml()}
      ${content}
    </main>
    ${playerHtml()}
  `;
}

function loginHtml() {
  return `
    <section class="login-screen">
      <div class="login-card">
        <h1 class="logo">Flix <em>de Pote</em></h1>
        <p class="lede">Streaming fictício para treinamento local. Nada aqui é um serviço real.</p>
        ${noticeHtml()}
        <form id="login-form" data-form="login">
          <label for="email">E-mail</label>
          <input id="email" name="email" type="email" autocomplete="username" required>
          <label for="password">Senha</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button class="primary" type="submit">Entrar</button>
        </form>
        <aside class="demo">
          <p>Contas fictícias</p>
          <p><strong>Free</strong> · maria.costa@pote.local</p>
          <p><strong>Pote Família</strong> · joao.lima@pote.local</p>
          <p>Senha das duas: pipoca</p>
        </aside>
      </div>
    </section>
  `;
}

function render() {
  document.querySelector('#app').innerHTML = state.user ? shellHtml() : loginHtml();
}

async function loadLibrary() {
  const [catalog, coupons, subscription] = await Promise.all([
    api('/api/catalog'),
    api('/api/coupons'),
    api('/api/subscription'),
  ]);
  state.movies = catalog.movies;
  state.coupons = coupons.coupons;
  state.redemptions = coupons.redemptions;
  state.plans = subscription.plans;
  state.orders = subscription.orders;
  state.user = subscription.user;
}

async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    await loadLibrary();
  } catch (error) {
    state.user = null;
    if (error.status !== 401) {
      state.notice = { type: 'error', text: error.message };
    }
  }
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'view') {
    state.view = target.dataset.view;
    state.player = null;
    state.notice = null;
    if (target.dataset.view === 'plans') {
      run(async () => {
        const [coupons, subscription] = await Promise.all([
          api('/api/coupons'),
          api('/api/subscription'),
        ]);
        state.coupons = coupons.coupons;
        state.redemptions = coupons.redemptions;
        state.user = subscription.user;
        state.orders = subscription.orders;
        state.plans = subscription.plans;
        render();
      });
      return;
    }
    render();
    return;
  }

  if (action === 'close-player') {
    state.player = null;
    render();
    return;
  }

  if (action === 'play') {
    const movie = state.movies.find((item) => String(item.id) === String(target.dataset.id));
    if (movie?.tier === 'premium' && !state.user?.isPremium) {
      state.player = { denied: true, message: 'Este título faz parte do plano Premium.' };
      render();
      return;
    }
    run(async () => {
      try {
        const data = await api(`/api/catalog/${target.dataset.id}/playback`, { method: 'POST' });
        state.player = { denied: false, movie: data.movie };
      } catch (error) {
        state.player = { denied: true, message: error.message };
      }
      render();
    });
    return;
  }

  if (action === 'checkout') {
    run(async () => {
      try {
        const data = await api('/api/subscription/orders', {
          method: 'POST',
          body: JSON.stringify({ plan: target.dataset.plan }),
        });
        state.checkout = data.order;
        state.user = data.user;
        state.orders = [data.order, ...state.orders];
        state.view = 'checkout';
        state.notice = null;
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
    return;
  }

  if (action === 'downgrade') {
    run(async () => {
      try {
        const data = await api('/api/subscription/free', {
          method: 'POST',
          body: JSON.stringify({ plan: 'free' }),
        });
        state.user = data.user;
        state.notice = { type: 'ok', text: 'Assinatura encerrada. A conta voltou ao Free.' };
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
    return;
  }

  if (action === 'redeem') {
    run(() => redeem(target.dataset.code));
    return;
  }

  if (action === 'logout') {
    run(async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        /* a sessão local é encerrada mesmo se o servidor já a invalidou */
      }
      state.user = null;
      state.player = null;
      state.movies = [];
      state.coupons = [];
      state.redemptions = [];
      state.view = 'catalog';
      state.notice = null;
      render();
    });
    return;
  }

  if (action === 'reset') {
    if (!window.confirm('Restaurar filmes, contas, planos, pedidos e cupons para o estado inicial?')) return;
    run(async () => {
      try {
        await api('/api/lab/reset', { method: 'POST' });
        state.user = null;
        state.player = null;
        state.movies = [];
        state.coupons = [];
        state.redemptions = [];
        state.view = 'catalog';
        state.notice = { type: 'ok', text: 'Dados restaurados. Entre novamente com as contas fictícias.' };
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.dataset.form) return;
  event.preventDefault();

  if (form.dataset.form === 'login') {
    const payload = new FormData(form);
    run(async () => {
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: payload.get('email'),
            password: payload.get('password'),
          }),
        });
        state.user = data.user;
        state.notice = null;
        state.view = 'catalog';
        await loadLibrary();
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
    return;
  }

  if (form.dataset.form === 'profile') {
    const name = new FormData(form).get('name');
    run(async () => {
      try {
        const data = await api('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        state.user = data.user;
        state.notice = { type: 'ok', text: 'Nome atualizado.' };
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
    return;
  }

  if (form.dataset.form === 'session') {
    const code = new FormData(form).get('code');
    run(async () => {
      try {
        const data = await api('/api/lab/session', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        state.notice = { type: 'ok', text: data.message };
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
    return;
  }

  if (form.dataset.form === 'coupon') {
    run(() => redeem(new FormData(form).get('code')));
    return;
  }

  if (form.dataset.form === 'checkout') {
    const payload = new FormData(form);
    run(async () => {
      try {
        const data = await api(`/api/subscription/orders/${state.checkout.id}/pay`, {
          method: 'POST',
          body: JSON.stringify({
            holder: payload.get('holder'),
            number: payload.get('number'),
            expiry: payload.get('expiry'),
            cvv: payload.get('cvv'),
          }),
        });
        state.user = data.user;
        state.checkout = null;
        state.view = 'plans';
        state.notice = { type: 'ok', text: `${data.user.planName} aprovado. O acesso vale neste laboratório.` };
        const subscription = await api('/api/subscription');
        state.orders = subscription.orders;
        state.plans = subscription.plans;
      } catch (error) {
        state.notice = { type: 'error', text: error.message };
      }
      render();
    });
  }
});

async function redeem(code) {
  try {
    const data = await api('/api/coupons/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    state.user = data.user;
    const coupons = await api('/api/coupons');
    state.coupons = coupons.coupons;
    state.redemptions = coupons.redemptions;
    state.notice = { type: 'ok', text: `Cupom ${data.coupon.code} aplicado.` };
  } catch (error) {
    state.notice = { type: 'error', text: error.message };
  }
  render();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.player) {
    state.player = null;
    render();
  }
});

boot();
