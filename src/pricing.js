/**
 * Pure pricing and calendar logic. No I/O, no clock — everything is passed in,
 * so the client and the server can run the same rules and disagree about nothing.
 */

export const SIZES = [0.5, 1, 1.5, 2];

export const EXTRAS = { eggless: 100, candles: 30 };
export const DELIVERY_FEE = 250;
export const DEPOSIT_RATE = 0.3;
export const SLOTS = ['10:00–13:00', '16:00–19:00'];

export const DEFAULT_CAPACITY = { weekday: 4, weekend: 6 };
export const CALENDAR_DAYS = 21;

/* ------------------------------------------------------------------ dates */

export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function weekday(iso) {
  return toDate(iso).getUTCDay();
}

export function diffDays(from, to) {
  return Math.round((toDate(to) - toDate(from)) / 86400000);
}

export function baseCapacity(iso) {
  const d = weekday(iso);
  return d === 0 || d === 6 ? DEFAULT_CAPACITY.weekend : DEFAULT_CAPACITY.weekday;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const shortDate = (iso) => `${toDate(iso).getUTCDate()} ${MONTHS[toDate(iso).getUTCMonth()]}`;
export const weekdayName = (iso) => DAYS[weekday(iso)];

export function longDate(iso) {
  const d = toDate(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* ---------------------------------------------------------------- pricing */

export const round10 = (n) => Math.round(n / 10) * 10;

export function priceFor(cake, { kg = 1, eggless = false, candles = false } = {}) {
  const base = round10(cake.pricePerKg * kg);
  const egg = eggless ? EXTRAS.eggless : 0;
  const can = candles ? EXTRAS.candles : 0;
  return {
    base,
    eggless: egg,
    candles: can,
    total: base + egg + can,
    deposit: round10((base + egg + can) * DEPOSIT_RATE),
  };
}

export function sizeOptions(cake) {
  const min = Number(cake.minKg) || 0.5;
  return SIZES.filter((s) => s >= min).map((kg) => ({
    kg,
    label: kg === 1 ? '1 kg' : kg < 1 ? `${kg * 1000} g` : `${kg} kg`,
  }));
}

/* ----------------------------------------------------------- availability */

/**
 * The one thing this product knows that a generic shop does not: a home baker
 * has four ovens' worth of a day, and a 3-day lead time that cannot be waived.
 * Every date gets a verdict in words, never a silent disabled button.
 */
export function dayStatus({ date, today, leadDays, used, capacity, closed, reason }) {
  if (closed) {
    // The customer needs "closed", not the family's business. The reason is
    // still carried for the tooltip and the baker's own view.
    return { status: 'closed', note: 'Closed', reason: reason || 'Baker is away' };
  }

  const earliest = addDays(today, leadDays);
  if (date < earliest) {
    const needs = leadDays === 1 ? '24h' : `${leadDays} days`;
    return { status: 'too_soon', note: `Needs ${needs}`, earliest };
  }

  const left = Math.max(0, capacity - used);
  if (left === 0) return { status: 'full', note: 'Fully booked' };
  if (left === 1) return { status: 'limited', note: 'Only 1 slot left' };
  return { status: 'open', note: `${left} slots left` };
}

/**
 * Build the whole calendar in one pass.
 * @param {object} cake      row with lead_days
 * @param {object[]} orders  rows with wanted_date, status
 * @param {object[]} overrides rows with date, slots, closed, reason
 */
export function buildCalendar({ cake, orders = [], overrides = [], today, days = CALENDAR_DAYS }) {
  const usedByDate = new Map();
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    usedByDate.set(o.wanted_date, (usedByDate.get(o.wanted_date) || 0) + 1);
  }
  const overridesByDate = new Map(overrides.map((o) => [o.date, o]));

  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(today, i);
    const ov = overridesByDate.get(date);
    const capacity = ov?.slots ?? baseCapacity(date);
    const used = usedByDate.get(date) || 0;
    const verdict = dayStatus({
      date,
      today,
      // Accept both shapes: the API speaks camelCase, the database row says
      // lead_days, and this rule must not change with who is calling it.
      leadDays: Number(cake.leadDays ?? cake.lead_days) || 2,
      used,
      capacity,
      closed: Boolean(ov?.closed),
      reason: ov?.reason,
    });

    out.push({
      date,
      weekday: weekdayName(date),
      dayOfMonth: toDate(date).getUTCDate(),
      month: MONTHS[toDate(date).getUTCMonth()],
      capacity,
      used,
      ...verdict,
    });
  }
  return out;
}

/* ------------------------------------------------------------- validation */

const PHONE = /^[6-9]\d{9}$/;

export function validateOrder(input, { cake, calendarDate }) {
  const errors = [];

  if (!input || typeof input !== 'object') return ['Bad request.'];

  const name = String(input.name || '').trim();
  const phone = String(input.phone || '').replace(/\s|-/g, '');
  const kg = Number(input.kg);
  const fulfilment = input.fulfilment === 'delivery' ? 'delivery' : 'pickup';

  if (name.length < 2) errors.push('Please give a name we can call out.');
  if (name.length > 60) errors.push('That name is too long.');

  if (!PHONE.test(phone)) errors.push('A 10-digit Indian mobile number, please.');

  if (!sizeOptions(cake).some((s) => s.kg === kg)) {
    errors.push('That size is not available for this cake.');
  }

  if (!SLOTS.includes(input.slot)) errors.push('Pick a collection window.');

  if (fulfilment === 'delivery') {
    const address = String(input.address || '').trim();
    if (address.length < 12) errors.push('A delivery address needs a little more detail.');
    if (address.length > 240) errors.push('That address is too long.');
  }

  if (String(input.inscription || '').length > 40) {
    errors.push('Keep the message on the cake under 40 characters.');
  }

  if (!calendarDate) {
    errors.push('That date is not on the calendar.');
  } else if (calendarDate.status !== 'open' && calendarDate.status !== 'limited') {
    errors.push(`${longDate(calendarDate.date)} is not available — ${calendarDate.note.toLowerCase()}.`);
  }

  return errors;
}
