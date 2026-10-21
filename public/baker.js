import { longDate } from '/shared/pricing.js';

const out = document.querySelector('#baker-out');
const keyInput = document.querySelector('#key');
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

const STATUSES = [
  ['new', 'New'],
  ['baking', 'In the oven'],
  ['ready', 'Ready'],
  ['done', 'Collected'],
  ['cancelled', 'Cancelled'],
];

let key = localStorage.getItem('crumb-key') || '';
keyInput.value = key;

async function load() {
  out.innerHTML = '<p class="hint">Loading orders…</p>';

  const res = await fetch(`/api/baker/orders?key=${encodeURIComponent(key)}`);
  if (res.status === 401) {
    out.innerHTML = '<p class="track-error">That key is not right.</p>';
    return;
  }
  const { orders, today } = await res.json();
  localStorage.setItem('crumb-key', key);
  render(orders, today);
}

function render(orders, today) {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const dueToday = live.filter((o) => o.date === today).length;
  const deposit = live.reduce((sum, o) => sum + o.deposit, 0);

  const stats = `
    <div class="stat-row">
      <div class="stat"><b>${live.length}</b><span>Live orders</span></div>
      <div class="stat"><b>${dueToday}</b><span>Due today</span></div>
      <div class="stat"><b>${money(deposit)}</b><span>Deposits to collect</span></div>
    </div>`;

  if (!orders.length) {
    out.innerHTML = `${stats}<p class="hint">No orders yet. Place one from the storefront.</p>`;
    return;
  }

  const byDate = new Map();
  for (const o of orders) {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push(o);
  }

  const groups = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const items = list
        .map(
          (o) => `
        <div class="order-row">
          <div class="order-code">${o.code}</div>
          <div class="order-main">
            <strong>${o.cakeName} · ${o.kg} kg${o.eggless ? ' · eggless' : ''}</strong>
            <span>${o.name} · ${o.phone} · ${o.slot} · ${o.fulfilment}</span>
            ${o.inscription ? `<span>“${o.inscription}”</span>` : ''}
          </div>
          <div class="order-main">
            <strong>${money(o.total)}</strong>
            <span>${money(o.deposit)} deposit</span>
          </div>
          <select data-id="${o.id}" aria-label="Status for ${o.code}">
            ${STATUSES.map(
              ([v, label]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${label}</option>`,
            ).join('')}
          </select>
        </div>`,
        )
        .join('');

      return `
        <section class="day-group">
          <div class="day-head">
            <h2>${longDate(date)}</h2>
            <span>${list.length} ${list.length === 1 ? 'cake' : 'cakes'}</span>
          </div>
          ${items}
        </section>`;
    })
    .join('');

  out.innerHTML = stats + groups;
}

out.addEventListener('change', async (e) => {
  const select = e.target.closest('select[data-id]');
  if (!select) return;

  select.disabled = true;
  try {
    const res = await fetch(
      `/api/baker/orders/${select.dataset.id}?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: select.value }),
      },
    );
    if (!res.ok) throw new Error();
    select.style.borderColor = 'var(--ok)';
    setTimeout(() => {
      select.style.borderColor = '';
    }, 1200);
  } catch {
    select.style.borderColor = 'var(--stop)';
    select.disabled = false;
  }
});

document.querySelector('#key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  key = keyInput.value.trim();
  load();
});

if (key) load();
