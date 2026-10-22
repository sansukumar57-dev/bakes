import { DELIVERY_FEE, priceFor, longDate, shortDate, weekdayName } from '/shared/pricing.js';

/* --------------------------------------------------------------- helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const lead = (days) => (days >= 3 ? `${days} days' notice` : `${days * 24}h notice`);

const state = {
  cakes: [],
  cake: null,
  calendar: [],
  selectedDate: null,
  filter: 'all',
  order: null,
};

/* ------------------------------------------------------------ cake drawing */

/**
 * A small, drawn cake per flavour. No photography, no stock images — the
 * palette comes from the cake's own colours, so the art can never claim
 * something the cake isn't.
 */
function cakeArt(palette, { tiers = 2, candle = false } = {}) {
  const p = palette || { sponge: '#efdcbb', frosting: '#fdf8ee', accent: '#c2a04a' };
  const edge = 'rgba(58, 32, 16, 0.22)';

  const tier = (x, y, w, h) => {
    const layers = [0.52, 0.74]
      .map(
        (f) =>
          `<line x1="${x + 7}" y1="${y + h * f}" x2="${x + w - 7}" y2="${y + h * f}" stroke="rgba(58,32,16,.12)" stroke-width="1.5"/>`,
      )
      .join('');

    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${p.sponge}" stroke="${edge}" stroke-width="1.4"/>`;
    s += layers;
    s += `<rect x="${x + w - 15}" y="${y + 5}" width="12" height="${h - 10}" rx="6" fill="rgba(58,32,16,.06)"/>`;
    s += `<rect x="${x - 5}" y="${y - 7}" width="${w + 10}" height="25" rx="11" fill="${p.frosting}" stroke="${edge}" stroke-width="1.4"/>`;
    const drops = [];
    for (let cx = x + 9; cx < x + w - 5; cx += 17) {
      drops.push(`<circle cx="${cx}" cy="${y + 16}" r="${5 + ((cx + w) % 4)}"/>`);
    }
    s += `<g fill="${p.frosting}" stroke="${edge}" stroke-width="1.2">${drops.join('')}</g>`;
    return s;
  };

  let body;
  let topY;
  if (tiers === 3) {
    body = tier(22, 106, 176, 44) + tier(46, 74, 128, 36) + tier(74, 44, 72, 34);
    topY = 44;
  } else {
    body = tier(30, 96, 160, 52) + tier(62, 54, 96, 46);
    topY = 54;
  }

  const cherryY = topY - 20;
  const candleEl = candle
    ? `<rect x="108" y="${topY - 44}" width="4" height="22" rx="2" fill="${p.accent}"/>
       <ellipse cx="110" cy="${topY - 47}" rx="3.4" ry="5" fill="#f2b544"/>`
    : '';

  return `<svg viewBox="0 0 220 172" role="img" aria-label="Illustration of the cake" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="110" cy="152" rx="84" ry="8.5" fill="rgba(36,27,22,.16)"/>
    ${body}
    ${candleEl}
    <circle cx="110" cy="${cherryY}" r="7" fill="${p.accent}" stroke="${edge}" stroke-width="1.2"/>
    <circle cx="107.5" cy="${cherryY - 2.5}" r="1.8" fill="rgba(255,255,255,.55)"/>
    <path d="M110 ${cherryY - 6} q3 -6 8 -8" stroke="${p.accent}" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* -------------------------------------------------------------- catalogue */

function renderCatalogue() {
  const grid = $('#cake-grid');
  if (!state.cakes.length) {
    grid.innerHTML = `<div class="skeleton-group" aria-hidden="true">${'<div class="skeleton"></div>'.repeat(3)}</div>`;
    return;
  }

  const list =
    state.filter === 'all' ? state.cakes : state.cakes.filter((c) => c.tags.includes(state.filter));

  grid.setAttribute('aria-busy', 'false');
  $('#catalogue-count').textContent = `${list.length} ${list.length === 1 ? 'cake' : 'cakes'}`;

  if (!list.length) {
    grid.innerHTML =
      '<p class="hint">Nothing in that filter. The baker keeps the list short on purpose.</p>';
    return;
  }

  grid.innerHTML = list
    .map((cake, i) => {
      const isTiered = cake.slug === 'three-tier';
      const flag = cake.tags.includes('bestseller')
        ? '<span class="card-flag">Most ordered</span>'
        : cake.minKg >= 2
          ? '<span class="card-flag">Delivery only</span>'
          : '';
      const art = cake.image
        ? `<img src="/img/${cake.image}" alt="${cake.imageAlt}" ${
            i < 3 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'
          } decoding="async" />`
        : cakeArt(cake.palette, { tiers: isTiered ? 3 : 2, candle: false });
      return `
      <button class="cake-card" data-action="open-cake" data-slug="${cake.slug}">
        <div class="card-art">
          ${flag}
          ${art}
        </div>
        <div class="card-body">
          <span class="card-name">${cake.name}</span>
          <span class="card-tagline">${cake.tagline}</span>
          <span class="card-meta">
            <span class="card-price">${money(cake.pricePerKg)}<span> / kg</span></span>
            <span class="card-lead">${lead(cake.leadDays)}</span>
          </span>
        </div>
      </button>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ build */

function selectedCakeState() {
  const cake = state.cake;
  return {
    kg: Number($('#build-form input[name="kg"]:checked')?.value || cake.minKg),
    eggless: $('#opt-eggless').checked && !$('#opt-eggless').disabled,
    candles: $('#opt-candles').checked,
  };
}

function recompute() {
  const { kg, eggless, candles } = selectedCakeState();
  const quote = computeQuote(kg, eggless, candles);
  renderSummary(quote);
  return quote;
}

/* The calendar entry the customer has picked, if any. */
function selectedDay() {
  return state.calendar.find((d) => d.date === state.selectedDate) || null;
}

/* An order can only be placed on a date the baker can still keep. */
function placeOrderEnabled() {
  const day = selectedDay();
  return Boolean(day) && (day.status === 'open' || day.status === 'limited');
}

function computeQuote(kg, eggless, candles) {
  return priceFor(state.cake, { kg, eggless, candles });
}

function renderSummary(quote) {
  const { kg, eggless, candles } = selectedCakeState();
  const delivery = $('#fulfil-options input:checked')?.value === 'delivery';
  const slot = $('#slot-options input:checked')?.value || '—';
  const date = state.selectedDate;

  const rows = [];
  rows.push(['Date', date ? longDate(date) : 'Pick a date']);
  rows.push(['Window', slot]);
  rows.push([`${state.cake.name} · ${kg === 1 ? '1 kg' : kg < 1 ? `${kg * 1000} g` : `${kg} kg`}`, money(quote.base)]);
  if (eggless) rows.push(['Eggless', `+${money(100)}`]);
  if (candles) rows.push(['Candles', `+${money(30)}`]);
  if (delivery) rows.push(['Delivery', `+${money(DELIVERY_FEE)}`]);

  $('#summary-list').innerHTML = rows
    .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
    .join('');

  const total = quote.total + (delivery ? DELIVERY_FEE : 0);
  $('#summary-total').textContent = money(total);
  $('#summary-deposit').textContent = delivery
    ? `${money(quote.deposit)} deposit · balance on delivery`
    : `${money(quote.deposit)} deposit · balance on collection`;

  const ready = placeOrderEnabled();
  $('#place-order').disabled = !ready;
}

/* ------------------------------------------------------------- build page */

function renderBuild() {
  const cake = state.cake;
  const isTiered = cake.slug === 'three-tier';

  $('#build-tagline').textContent = cake.tagline;
  $('#build-title').textContent = cake.name;
  $('#build-description').textContent = cake.description;
  $('#build-art').innerHTML = cake.image
    ? `<img src="/img/${cake.image}" alt="${cake.imageAlt}" decoding="async" />`
    : cakeArt(cake.palette, { tiers: isTiered ? 3 : 2, candle: isTiered });

  const badges = [`${lead(cake.leadDays)}`, `From ${money(cake.pricePerKg)}/kg`];
  if (cake.tags.includes('eggless-available')) badges.push('Eggless available');
  if (cake.minKg >= 2) badges.push('Delivery only');
  $('#build-badges').innerHTML = badges.map((b) => `<li>${b}</li>`).join('');

  /* sizes */
  $('#size-options').innerHTML = cake.sizes
    .map(
      (s, i) => `
      <label class="option">
        <input type="radio" name="kg" value="${s.kg}" ${i === 0 ? 'checked' : ''} />
        ${s.label}
      </label>`,
    )
    .join('');

  const minLabel = cake.sizes[0].label;
  $('#size-hint').textContent =
    cake.minKg >= 2
      ? `This one starts at ${minLabel} — three tiers cannot be built smaller.`
      : `Smallest is ${minLabel}. Everything is priced per kilo, so the maths is visible.`;

  /* eggless */
  const egg = $('#opt-eggless');
  const canEggless = cake.tags.includes('eggless-available');
  egg.checked = false;
  egg.disabled = !canEggless;
  $('#eggless-note').textContent = canEggless
    ? 'Same recipe, no egg. Add ₹100.'
    : 'This cake is not available eggless — we would rather say so than pretend.';

  /* inscription */
  $('#inscription').value = '';
  $('#inscription-count').textContent = '0';

  /* dates */
  renderCalendar();

  /* slots */
  $('#slot-options').innerHTML = ['10:00–13:00', '16:00–19:00']
    .map(
      (s, i) => `
      <label class="option">
        <input type="radio" name="slot" value="${s}" ${i === 0 ? 'checked' : ''} />
        ${s}
      </label>`,
    )
    .join('');

  /* fulfilment */
  $('#fulfil-options').innerHTML = `
    <label class="option">
      <input type="radio" name="fulfil" value="pickup" checked />
      Pickup<small>HSR Layout</small>
    </label>
    <label class="option">
      <input type="radio" name="fulfil" value="delivery" ${cake.minKg >= 2 ? 'checked' : ''} />
      Delivery<small>+${money(DELIVERY_FEE)}</small>
    </label>`;

  $('#address-field').hidden = cake.minKg < 2;
  $('#errors').hidden = true;

  window.scrollTo({ top: 0, behavior: 'instant' });
  recompute();
}

function renderCalendar() {
  const grid = $('#date-grid');
  const cake = state.cake;

  grid.innerHTML = state.calendar
    .map((d) => {
      const usable = d.status === 'open' || d.status === 'limited';
      const why = d.reason ? `${d.note}: ${d.reason}` : d.note;
      return `
      <button
        type="button"
        class="date-chip"
        role="radio"
        aria-checked="${state.selectedDate === d.date}"
        data-state="${d.status}"
        data-action="pick-date"
        data-date="${d.date}"
        ${usable ? '' : 'disabled'}
        title="${why}"
        aria-label="${weekdayName(d.date)} ${d.dayOfMonth} ${d.month} — ${why}"
      >
        <span class="dc-dow">${d.weekday}</span>
        <span class="dc-day">${d.dayOfMonth}</span>
        <span class="dc-mon">${d.month}</span>
        <span class="dc-note">${d.note}</span>
      </button>`;
    })
    .join('');

  const notice = state.cake.leadDays === 1 ? '24 hours' : `${state.cake.leadDays} days`;
  const earliest = state.calendar.find((d) => d.earliest)?.earliest;
  const full = state.calendar.filter((d) => d.status === 'full').length;

  let hint = `This cake needs ${notice}' notice, so the earliest date is ${earliest ? shortDate(earliest) : 'later'}.`;
  if (full) hint += ` ${full} ${full === 1 ? 'date is' : 'dates are'} already full.`;
  $('#calendar-hint').textContent = hint;

  $('#place-order').disabled = !placeOrderEnabled();
}

/* ------------------------------------------------------------------ order */

function readForm() {
  const { kg, eggless, candles } = selectedCakeState();
  return {
    cakeId: state.cake.id,
    date: state.selectedDate,
    kg,
    eggless,
    candles,
    inscription: $('#inscription').value.trim(),
    slot: $('#slot-options input:checked').value,
    fulfilment: $('#fulfil-options input:checked').value,
    address: $('#address').value.trim(),
    name: $('#name').value.trim(),
    phone: $('#phone').value.replace(/\s|-/g, ''),
  };
}

async function submitOrder() {
  const btn = $('#place-order');
  const errors = $('#errors');
  errors.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Placing…';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    const data = await res.json();

    if (!res.ok) {
      const list = data.errors || [data.error || 'Something went wrong.'];
      errors.innerHTML = `<ul>${list.map((e) => `<li>${e}</li>`).join('')}</ul>`;
      errors.hidden = false;
      errors.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    state.order = data.order;
    renderDone();
  } catch {
    errors.innerHTML = '<ul><li>Could not reach the baker. Check your connection.</li></ul>';
    errors.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place order';
  }
}

function renderDone() {
  const o = state.order;
  const balance = o.total - o.deposit;

  $('#done-summary').textContent = `${o.cakeName} for ${o.dateLabel}, ${o.slot}.`;
  $('#done-code').textContent = o.code;

  $('#done-lines').innerHTML = `
    <div><dt>Cake</dt><dd>${o.cakeName} · ${o.kg} kg</dd></div>
    <div><dt>Date</dt><dd>${o.dateLabel}</dd></div>
    <div><dt>Window</dt><dd>${o.slot}</dd></div>
    <div><dt>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dt><dd>${o.fulfilment === 'delivery' ? 'Within 5 km' : 'HSR Layout'}</dd></div>
    <div><dt>Total</dt><dd>${money(o.total)}</dd></div>
    <div><dt>Deposit due</dt><dd>${money(o.deposit)}</dd></div>
    <div><dt>Balance</dt><dd>${money(balance)}</dd></div>`;

  $('#done-track').dataset.code = o.code;
  showView('view-done');
  // Keep the URL honest so a reload does not bounce back to the builder.
  if (location.hash !== '#/done') location.hash = '#/done';
}

/* ------------------------------------------------------------------ track */

const STATUS_LABEL = {
  new: 'With the baker',
  baking: 'In the oven',
  ready: 'Ready for collection',
  done: 'Collected',
  cancelled: 'Cancelled',
};

async function lookupOrder(code) {
  const box = $('#track-result');
  box.innerHTML = '<p class="hint">Looking…</p>';

  const res = await fetch(`/api/orders/${encodeURIComponent(code)}`);
  if (!res.ok) {
    box.innerHTML = '<p class="track-error">No order with that code. Check the letters and try again.</p>';
    return;
  }
  const { order } = await res.json();

  box.innerHTML = `
    <div class="track-card">
      <p class="eyebrow">${order.code}</p>
      <h2>${order.cakeName}</h2>
      <p class="hint">${longDate(order.date)} · ${order.slot} · ${order.kg} kg</p>
      <p class="track-status" data-status="${order.status}">${STATUS_LABEL[order.status] || order.status}</p>
      <dl class="receipt-lines" style="margin-top:18px;margin-bottom:0">
        <div><dt>Name</dt><dd>${order.name}</dd></div>
        <div><dt>${order.fulfilment === 'delivery' ? 'Delivering to' : 'Collecting'}</dt><dd>${order.fulfilment === 'delivery' ? order.address : 'HSR Layout'}</dd></div>
        <div><dt>Total</dt><dd>${money(order.total)}</dd></div>
        <div><dt>Deposit</dt><dd>${money(order.deposit)}</dd></div>
      </dl>
    </div>`;
}

/* ----------------------------------------------------------------- router */

function showView(id) {
  $$('.view').forEach((v) => {
    v.hidden = v.id !== id;
  });
  const heading = $(`#${id} h1`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function openCake(slug) {
  showView('view-build');
  $('#build-title').textContent = 'Loading…';
  $('#build-art').innerHTML = '';
  $('#date-grid').innerHTML = '<div class="skeleton" style="height:74px"></div>';

  const res = await fetch(`/api/cakes/${slug}`);
  if (!res.ok) {
    location.hash = '#/';
    return;
  }
  const data = await res.json();

  state.cake = data.cake;
  state.calendar = data.calendar;
  const soonest = data.calendar.find((d) => d.status === 'open' || d.status === 'limited');
  state.selectedDate = soonest ? soonest.date : null;

  renderBuild();
  document.title = `${data.cake.name} — Crumb`;
}

/*
 * The bottom tab bar is only on small screens, but it still has to say where
 * you are. "Home" stays lit while you are inside the shop — on a cake page or
 * the receipt — and "Track" takes over on the tracking screen.
 */
function setActiveTab(hash) {
  const isTrack = hash === '#/track';
  const isHome = !isTrack;
  $$('.tabbar a').forEach((a) => {
    const on = a.dataset.tab === 'home' ? isHome : isTrack;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route() {
  const hash = location.hash || '#/';

  setActiveTab(hash);

  if (hash.startsWith('#/cake/')) {
    await openCake(hash.slice('#/cake/'.length));
    return;
  }

  if (hash === '#/track') {
    showView('view-track');
    document.title = 'Track an order — Crumb';
    return;
  }

  if (hash === '#/done' && state.order) {
    showView('view-done');
    return;
  }

  showView('view-catalogue');
  document.title = 'Crumb — order a cake for a date that exists';
}

/* ------------------------------------------------------------------ boots */

async function loadCakes() {
  const res = await fetch('/api/cakes');
  const data = await res.json();
  state.cakes = data.cakes;
  renderCatalogue();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  if (action === 'open-cake') {
    location.hash = `#/cake/${el.dataset.slug}`;
  }

  if (action === 'home') {
    location.hash = '#/';
    e.preventDefault();
  }

  if (action === 'pick-date') {
    state.selectedDate = el.dataset.date;
    renderCalendar();
    recompute();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'fulfil') {
    $('#address-field').hidden = e.target.value !== 'delivery';
  }
  if ($('#build-form')?.contains(e.target)) recompute();
});

$('#build-form')?.addEventListener('input', (e) => {
  if (e.target.id === 'inscription') {
    $('#inscription-count').textContent = e.target.value.length;
  }
});

$('#place-order')?.addEventListener('click', submitOrder);

$('#track-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#track-code').value.trim().toUpperCase();
  if (code.length < 4) return;
  lookupOrder(code);
});

$('#done-track')?.addEventListener('click', (e) => {
  $('#track-code').value = e.currentTarget.dataset.code || '';
});

$$('.filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    $$('.filters .chip').forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    renderCatalogue();
  });
});

window.addEventListener('hashchange', route);

loadCakes();
route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // `updateViaCache: 'none'` lets the browser check for a new worker on
    // every visit, so a deploy is never hidden behind a cached script.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
