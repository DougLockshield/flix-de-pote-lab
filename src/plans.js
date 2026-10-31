export const PLAN_IDS = ['free', 'solo', 'familia', 'ostentacao'];

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceCents: 0,
    paid: false,
    screens: '1',
    quality: 'SD',
    premieres: false,
    tagline: 'O catálogo de entrada, sem mensalidade.',
    benefits: ['Filmes Free', '1 tela', 'Sem a coleção Premium'],
  },
  {
    id: 'solo',
    name: 'Pote Solo',
    priceCents: 1890,
    paid: true,
    screens: '1',
    quality: 'HD',
    premieres: false,
    tagline: 'A coleção Premium para uma pessoa.',
    benefits: ['Coleção Premium', '1 tela', 'Qualidade HD'],
  },
  {
    id: 'familia',
    name: 'Pote Família',
    priceCents: 2990,
    paid: true,
    screens: '4',
    quality: 'Full HD',
    premieres: false,
    tagline: 'A casa inteira no mesmo pote.',
    benefits: ['Coleção Premium', '4 telas', 'Qualidade Full HD'],
  },
  {
    id: 'ostentacao',
    name: 'Pote Ostentação',
    priceCents: 4490,
    paid: true,
    screens: '6',
    quality: '4K',
    premieres: true,
    tagline: 'O plano mais cheio do laboratório.',
    benefits: ['Coleção Premium', '6 telas', 'Qualidade 4K', 'Estreias fictícias primeiro'],
  },
];

const LEGACY_PREMIUM = {
  id: 'premium',
  name: 'Premium',
  priceCents: 0,
  paid: true,
};

export const TEST_PAYMENT = {
  holder: 'Maria Costa',
  number: '4242424242424242',
  expiry: '12/30',
  cvv: '123',
};

export function formatPrice(cents) {
  const value = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${value}`;
}

export function planById(id) {
  return PLANS.find((plan) => plan.id === id) || (id === LEGACY_PREMIUM.id ? LEGACY_PREMIUM : null);
}

export function isPaidPlan(id) {
  const plan = planById(id);
  return Boolean(plan?.paid);
}

export function publicPlans() {
  return PLANS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    priceCents: plan.priceCents,
    priceLabel: formatPrice(plan.priceCents),
    paid: plan.paid,
    screens: plan.screens,
    quality: plan.quality,
    premieres: plan.premieres,
    tagline: plan.tagline,
    benefits: plan.benefits,
  }));
}

export function isTestPayment(body) {
  const holder = String(body?.holder || '').trim().toLowerCase();
  const number = String(body?.number || '').replace(/\s+/g, '');
  const expiry = String(body?.expiry || '').trim();
  const cvv = String(body?.cvv || '').trim();
  return holder === TEST_PAYMENT.holder.toLowerCase()
    && number === TEST_PAYMENT.number
    && expiry === TEST_PAYMENT.expiry
    && cvv === TEST_PAYMENT.cvv;
}
