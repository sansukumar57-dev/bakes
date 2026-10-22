// End-to-end checks against a running server. Not part of `npm test`
// because it needs `npm start` up on the same port.
const base = process.env.CRUMB_URL || 'http://localhost:4174';
const out = [];
const ok = (label, cond, extra = '') =>
  out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

const req = async (path, opts) => {
  const res = await fetch(base + path, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

let up = false;
for (let i = 0; i < 25; i += 1) {
  try {
    const r = await fetch(base + '/api/cakes');
    if (r.ok) {
      up = true;
      break;
    }
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 300));
}
if (!up) {
  console.log('SERVER NOT UP');
  process.exit(1);
}

const cakes = await req('/api/cakes');
ok('catalogue returns 8 cakes', cakes.status === 200 && cakes.body.cakes.length === 8, `got ${cakes.body?.cakes?.length}`);
ok(
  'every cake carries a photograph and alt text',
  cakes.body.cakes.every((c) => c.image && c.imageAlt),
);
ok(
  'size options never fall below the cake minimum',
  cakes.body.cakes.every((c) => c.sizes.every((s) => s.kg >= c.minKg) && c.sizes[0].kg === c.minKg),
  cakes.body.cakes.map((c) => `${c.slug}:${c.minKg}->${c.sizes.map((s) => s.kg).join('/')}`).join(' '),
);

const detail = await req('/api/cakes/vanilla-bean');
const cal = detail.body.calendar;
const full = cal.find((d) => d.status === 'full');
const closed = cal.find((d) => d.status === 'closed');
ok('calendar has 21 days', cal.length === 21);
ok('one day is full', Boolean(full), full ? `${full.date} used ${full.used}/${full.capacity}` : 'none');
ok('one day is closed with a reason', Boolean(closed), closed ? `${closed.date} "${closed.reason}"` : 'none');
ok('too-soon days name the earliest legal date', cal.filter((d) => d.status === 'too_soon').every((d) => d.earliest));

const photo = await fetch(`${base}/img/${cakes.body.cakes[0].image}`);
ok('photographs are served', photo.ok && photo.headers.get('content-type').startsWith('image/'));

/* Every cake must honour its own notice period, not a shared default. */
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const notice = [];
for (const c of cakes.body.cakes) {
  const cal2 = (await req(`/api/cakes/${c.slug}`)).body.calendar;
  const today = cal2[0].date;
  const firstUsable = cal2.find((x) => x.status !== 'too_soon');
  const boundary = addDays(today, c.leadDays);
  const tooSoon = cal2.filter((x) => x.status === 'too_soon').length;
  const expectedTooSoon = Math.min(c.leadDays, cal2.length);
  const problems = [];
  if (!firstUsable || firstUsable.date < boundary) {
    problems.push(`${c.slug} firstUsable=${firstUsable?.date} boundary=${boundary}`);
  }
  if (tooSoon !== expectedTooSoon) {
    problems.push(`${c.slug} tooSoon=${tooSoon} expected=${expectedTooSoon}`);
  }
  notice.push(...problems);
}
ok('each calendar honours its own notice period', notice.length === 0, notice.join('; '));

const open = cal.find((d) => d.status === 'open' || d.status === 'limited');
const baseOrder = {
  cakeId: detail.body.cake.id,
  date: open.date,
  kg: 1,
  eggless: false,
  candles: true,
  inscription: 'Smoke test',
  slot: '10:00–13:00',
  fulfilment: 'pickup',
  address: '',
  name: 'Test Person',
  phone: '9876543210',
};
const postOrder = (patch) =>
  req('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseOrder, ...patch }),
  });

const created = await postOrder({});
ok(
  'valid order returns 201 + code',
  created.status === 201 && /^CRB-[A-Z0-9]{5}$/.test(created.body?.code || ''),
  `${created.status} ${created.body?.code || JSON.stringify(created.body)}`,
);
ok('price is computed server-side', created.body?.order?.total === 930, `total ${created.body?.order?.total}`);

const badPhone = await postOrder({ phone: '98765432' });
ok('8-digit phone returns 422', badPhone.status === 422, (badPhone.body?.errors || []).join(' | '));

const badSize = await postOrder({ kg: 3 });
ok('invalid size returns 422', badSize.status === 422);

const overbooked = await postOrder({ date: full.date });
ok(
  'a full date is refused in words',
  overbooked.status === 422,
  `${overbooked.status} ${(overbooked.body?.errors || [overbooked.body?.error]).join(' | ')}`,
);

const looked = await req(`/api/orders/${created.body.code}`);
ok('order lookup by code works', looked.status === 200 && looked.body.order.code === created.body.code);
ok('lookup includes the cake name', looked.body?.order?.cakeName === 'Classic Vanilla Bean');

const noKey = await req('/api/baker/orders');
ok('baker endpoint rejects a missing key', noKey.status === 401);

const baker = await req('/api/baker/orders?key=crumb-demo');
ok('baker endpoint lists orders', baker.status === 200 && baker.body.orders.length >= 6, `${baker.body?.orders?.length} orders`);

const firstId = baker.body.orders[0].id;
const bumped = await req(`/api/baker/orders/${firstId}?key=crumb-demo`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'baking' }),
});
ok('baker can change a status', bumped.status === 200 && bumped.body.status === 'baking');

const badStatus = await req(`/api/baker/orders/${firstId}?key=crumb-demo`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'nonsense' }),
});
ok('baker cannot set a nonsense status', badStatus.status === 422);

const shared = await fetch(base + '/shared/pricing.js');
ok('shared pricing module is served to the browser', shared.status === 200 && (await shared.text()).includes('export function priceFor'));

const page = await fetch(base + '/');
const html = await page.text();
ok('storefront renders', page.status === 200 && html.includes('Order a cake for a date'));

const bakerPage = await fetch(base + '/baker');
ok('/baker route serves the baker view', bakerPage.status === 200 && (await bakerPage.text()).includes('Today at the counter'));

console.log(out.join('\n'));
const passed = out.filter((l) => l.startsWith('PASS')).length;
console.log(`\n${passed}/${out.length} passed`);
process.exit(passed === out.length ? 0 : 1);
