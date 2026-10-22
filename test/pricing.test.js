import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  buildCalendar,
  dayStatus,
  priceFor,
  sizeOptions,
  validateOrder,
  DELIVERY_FEE,
} from '../src/pricing.js';

const cake = { pricePerKg: 1000, minKg: 1, leadDays: 2 };

/* ---------------------------------------------------------------- pricing */

test('price is per kilo, rounded to the nearest ten', () => {
  const q = priceFor(cake, { kg: 1.5 });
  assert.equal(q.base, 1500);
  assert.equal(q.total, 1500);
  assert.equal(q.deposit, 450);
});

test('extras are added in rupees, not percentages', () => {
  const q = priceFor(cake, { kg: 1, eggless: true, candles: true });
  assert.equal(q.base, 1000);
  assert.equal(q.eggless, 100);
  assert.equal(q.candles, 30);
  assert.equal(q.total, 1130);
  assert.equal(q.deposit, 340);
});

test('deposit is thirty percent, rounded to ten', () => {
  const q = priceFor({ pricePerKg: 1250 }, { kg: 1.5 });
  assert.equal(q.total, 1880);
  assert.equal(q.deposit, 560);
});

test('sizes never go below the cake minimum', () => {
  assert.deepEqual(sizeOptions({ minKg: 0.5 }).map((s) => s.kg), [0.5, 1, 1.5, 2]);
  assert.deepEqual(sizeOptions({ minKg: 2 }).map((s) => s.kg), [2]);
});

/* ----------------------------------------------------------- availability */

const base = { today: '2026-11-01', leadDays: 2, capacity: 4, used: 0, closed: false };

test('a date inside the notice period is refused, with the earliest named', () => {
  const d = dayStatus({ ...base, date: '2026-11-02' });
  assert.equal(d.status, 'too_soon');
  assert.equal(d.note, 'Needs 2 days');
  assert.equal(d.earliest, '2026-11-03');
});

test('the first legal date is open', () => {
  const d = dayStatus({ ...base, date: '2026-11-03' });
  assert.equal(d.status, 'open');
  assert.equal(d.note, '4 slots left');
});

test('one slot left is called out as limited, not open', () => {
  const d = dayStatus({ ...base, date: '2026-11-05', used: 3 });
  assert.equal(d.status, 'limited');
  assert.equal(d.note, 'Only 1 slot left');
});

test('a full day is full, never "short wait"', () => {
  const d = dayStatus({ ...base, date: '2026-11-05', used: 4 });
  assert.equal(d.status, 'full');
});

test('closed beats every other rule', () => {
  const d = dayStatus({ ...base, date: '2026-11-20', closed: true, reason: 'Baker is away' });
  assert.equal(d.status, 'closed');
  assert.equal(d.note, 'Closed');
  assert.equal(d.reason, 'Baker is away');
});

test('calendar spans the window and honours a manual override', () => {
  const closedDate = addDays('2026-11-01', 10);
  const days = buildCalendar({
    cake: { leadDays: 2 },
    today: '2026-11-01',
    days: 21,
    orders: [{ wanted_date: addDays('2026-11-01', 6), status: 'new' }],
    overrides: [{ date: closedDate, slots: null, closed: 1, reason: 'Family function' }],
  });

  assert.equal(days.length, 21);
  assert.equal(days[0].date, '2026-11-01');
  assert.equal(days[2].date, '2026-11-03');
  assert.equal(days[0].status, 'too_soon');
  assert.equal(days.find((d) => d.date === closedDate).status, 'closed');
  assert.equal(days.find((d) => d.date === addDays('2026-11-01', 6)).used, 1);
});

test('cancelled orders release their slot', () => {
  const days = buildCalendar({
    cake: { leadDays: 1 },
    today: '2026-11-01',
    days: 3,
    orders: [
      { wanted_date: '2026-11-02', status: 'new' },
      { wanted_date: '2026-11-02', status: 'cancelled' },
    ],
  });
  assert.equal(days[1].used, 1);
  assert.equal(days[1].status, 'open');
});

test('the notice period survives either field name', () => {
  // The API speaks camelCase, a database row says lead_days. The rule must
  // not quietly fall back to two days if it is handed the wrong shape.
  const fromApi = buildCalendar({ cake: { leadDays: 5 }, today: '2026-11-01', days: 10 });
  const fromRow = buildCalendar({ cake: { lead_days: 5 }, today: '2026-11-01', days: 10 });

  assert.equal(fromApi.filter((d) => d.status === 'too_soon').length, 5);
  assert.equal(fromRow.filter((d) => d.status === 'too_soon').length, 5);
  assert.equal(fromApi[6].status, 'open');
  assert.equal(fromRow[6].status, 'open');
});

/* ------------------------------------------------------------- validation */

const openDate = { date: '2026-11-10', status: 'open', note: '4 slots left' };
const good = {
  name: 'Prema',
  phone: '9876543210',
  kg: 1,
  slot: '10:00–13:00',
  fulfilment: 'pickup',
  inscription: 'Happy birthday',
};

test('a clean order passes', () => {
  assert.deepEqual(validateOrder(good, { cake, calendarDate: openDate }), []);
});

test('an eight-digit phone is rejected', () => {
  const errors = validateOrder({ ...good, phone: '98765432' }, { cake, calendarDate: openDate });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /10-digit/);
});

test('a size below the minimum is rejected', () => {
  const errors = validateOrder({ ...good, kg: 0.5 }, { cake, calendarDate: openDate });
  assert.match(errors.join(' '), /not available/);
});

test('a full date is rejected in words the user can act on', () => {
  const errors = validateOrder(good, {
    cake,
    calendarDate: { date: '2026-11-10', status: 'full', note: 'Fully booked' },
  });
  assert.match(errors[0], /10 Nov/);
  assert.match(errors[0], /fully booked/);
});

test('delivery needs a real address', () => {
  const errors = validateOrder(
    { ...good, fulfilment: 'delivery', address: 'HSR' },
    { cake, calendarDate: openDate },
  );
  assert.match(errors.join(' '), /address/);
});

test('delivery fee is a constant the client and server share', () => {
  assert.equal(DELIVERY_FEE, 250);
});
