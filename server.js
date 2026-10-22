import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { db, nowIso, todayStr, makeCode, ROOT } from './src/db.js';
import {
  CALENDAR_DAYS,
  buildCalendar,
  priceFor,
  sizeOptions,
  validateOrder,
  longDate,
  DELIVERY_FEE,
  SLOTS,
} from './src/pricing.js';
import { seed } from './src/seed.js';

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = join(ROOT, 'public');
const BAKER_KEY = process.env.CRUMB_BAKER_KEY || 'crumb-demo';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/* ---------------------------------------------------------------- helpers */

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const readBody = (req, limit = 32 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Malformed JSON'));
      }
    });
    req.on('error', reject);
  });

const rowToCake = (row) => {
  const cake = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    pricePerKg: row.price_per_kg,
    minKg: row.min_kg,
    leadDays: row.lead_days,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    palette: row.palette ? JSON.parse(row.palette) : null,
    image: row.image || '',
    imageAlt: row.image_alt || '',
  };
  // Size options are derived from the mapped cake, never the raw row — the
  // rules read camelCase and the database speaks snake_case.
  return { ...cake, sizes: sizeOptions(cake) };
};

const rowToOrder = (row) => ({
  id: row.id,
  code: row.code,
  cakeId: row.cake_id,
  cakeName: row.cake_name || null,
  kg: row.size_kg,
  eggless: Boolean(row.eggless),
  candles: Boolean(row.candles),
  inscription: row.inscription,
  date: row.wanted_date,
  slot: row.slot,
  fulfilment: row.fulfilment,
  name: row.name,
  phone: row.phone,
  address: row.address,
  total: row.total,
  deposit: row.deposit,
  status: row.status,
  createdAt: row.created_at,
});

const capacityRows = (from, days) => {
  const to = new Date(`${from}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + days);
  return db
    .prepare('SELECT * FROM day_overrides WHERE date >= ? AND date < ?')
    .all(from, to.toISOString().slice(0, 10));
};

const orderRows = (from, days) => {
  const to = new Date(`${from}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + days);
  return db
    .prepare('SELECT * FROM orders WHERE wanted_date >= ? AND wanted_date < ?')
    .all(from, to.toISOString().slice(0, 10));
};

const calendarFor = (cake) => {
  const today = todayStr();
  return buildCalendar({
    cake,
    orders: orderRows(today, CALENDAR_DAYS),
    overrides: capacityRows(today, CALENDAR_DAYS),
    today,
    days: CALENDAR_DAYS,
  });
};

/* ------------------------------------------------------------------ routes */

const getCake = (idOrSlug) =>
  db.prepare('SELECT * FROM cakes WHERE slug = ? OR id = ?').get(String(idOrSlug), Number(idOrSlug) || -1);

const api = {
  'GET /api/cakes': (req, res) => {
    const rows = db.prepare('SELECT * FROM cakes ORDER BY position').all();
    sendJson(res, 200, { cakes: rows.map(rowToCake), today: todayStr() });
  },

  'GET /api/cakes/:id': (req, res, params) => {
    const row = getCake(params.id);
    if (!row) return sendJson(res, 404, { error: 'No such cake.' });
    const cake = rowToCake(row);
    sendJson(res, 200, {
      cake,
      calendar: calendarFor(cake),
      deliveryFee: DELIVERY_FEE,
      slots: SLOTS,
      today: todayStr(),
    });
  },

  'POST /api/orders': async (req, res) => {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const row = getCake(body.cakeId ?? body.slug ?? '');
    if (!row) return sendJson(res, 404, { error: 'No such cake.' });

    const cake = rowToCake(row);
    const calendar = calendarFor(cake);
    const chosen = calendar.find((d) => d.date === body.date);

    const errors = validateOrder(body, { cake, calendarDate: chosen });
    if (errors.length) return sendJson(res, 422, { errors });

    const kg = Number(body.kg);
    const eggless = Boolean(body.eggless);
    const candles = Boolean(body.candles);
    const prices = priceFor(cake, { kg, eggless, candles });
    const fulfilment = body.fulfilment === 'delivery' ? 'delivery' : 'pickup';
    const total = prices.total + (fulfilment === 'delivery' ? DELIVERY_FEE : 0);
    const deposit = prices.deposit;

    // Capacity is claimed inside a write transaction, so two people tapping
    // "confirm" on the last slot cannot both win.
    db.exec('BEGIN IMMEDIATE');
    try {
      const used = db
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE wanted_date = ? AND status != 'cancelled'")
        .get(body.date).n;
      const override = db.prepare('SELECT * FROM day_overrides WHERE date = ?').get(body.date);
      const capacity = override?.slots ?? (chosen?.capacity || 4);
      const closed = Boolean(override?.closed);

      if (closed) {
        db.exec('ROLLBACK');
        return sendJson(res, 409, { error: `${longDate(body.date)} has just been closed.` });
      }
      if (used >= capacity) {
        db.exec('ROLLBACK');
        return sendJson(res, 409, {
          error: `${longDate(body.date)} filled up while you were deciding. Pick another date.`,
        });
      }

      const code = makeCode();
      db.prepare(`
        INSERT INTO orders (code, cake_id, size_kg, eggless, candles, inscription, wanted_date, slot,
                            fulfilment, name, phone, address, total, deposit, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `).run(
        code,
        row.id,
        kg,
        eggless ? 1 : 0,
        candles ? 1 : 0,
        String(body.inscription || '').trim(),
        body.date,
        body.slot,
        fulfilment,
        String(body.name).trim(),
        String(body.phone).replace(/\s|-/g, ''),
        String(body.address || '').trim(),
        total,
        deposit,
        nowIso(),
      );

      db.exec('COMMIT');
      return sendJson(res, 201, {
        code,
        order: {
          code,
          cakeName: row.name,
          kg,
          date: body.date,
          dateLabel: longDate(body.date),
          slot: body.slot,
          total,
          deposit,
          balance: total - deposit,
          fulfilment,
        },
      });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      console.error(err);
      return sendJson(res, 500, { error: 'Could not save the order. Try once more.' });
    }
  },

  'GET /api/orders/:code': (req, res, params) => {
    const row = db
      .prepare(
        `SELECT o.*, c.name AS cake_name FROM orders o JOIN cakes c ON c.id = o.cake_id WHERE o.code = ?`,
      )
      .get(String(params.code).toUpperCase());
    if (!row) return sendJson(res, 404, { error: 'No order with that code.' });
    sendJson(res, 200, { order: rowToOrder(row) });
  },

  'GET /api/baker/orders': (req, res, params, url) => {
    if (url.searchParams.get('key') !== BAKER_KEY) {
      return sendJson(res, 401, { error: 'Wrong key.' });
    }
    const rows = db
      .prepare(
        `SELECT o.*, c.name AS cake_name FROM orders o JOIN cakes c ON c.id = o.cake_id
         ORDER BY o.wanted_date ASC, o.created_at ASC`,
      )
      .all();
    sendJson(res, 200, { orders: rows.map(rowToOrder), today: todayStr() });
  },

  'POST /api/baker/orders/:id': async (req, res, params, url) => {
    if (url.searchParams.get('key') !== BAKER_KEY) {
      return sendJson(res, 401, { error: 'Wrong key.' });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const allowed = ['new', 'baking', 'ready', 'done', 'cancelled'];
    if (!allowed.includes(body.status)) return sendJson(res, 422, { error: 'Unknown status.' });

    const result = db
      .prepare('UPDATE orders SET status = ? WHERE id = ?')
      .run(body.status, Number(params.id));
    if (!result.changes) return sendJson(res, 404, { error: 'No such order.' });
    sendJson(res, 200, { ok: true, status: body.status });
  },
};

/* ------------------------------------------------------------------ static */

/*
 * Code must never be served stale. The service worker is network-first, but its
 * own fetch still goes through the HTTP cache — so if the server hands out
 * `max-age=300` for app.js, a deploy stays invisible for five minutes and the
 * worker then caches the old file. `no-cache` means "revalidate every time",
 * which is cheap for text and correct.
 *
 * Photographs never change, so those are the only thing worth pinning.
 *
 * This keys off the request path, never off the normalised filesystem path:
 * `path.normalize` turns "/img/x.jpg" into "\img\x.jpg" on Windows, which
 * would quietly defeat every prefix check below.
 */
function cacheControl(pathname, isShared) {
  if (isShared) return 'no-cache';
  if (pathname === '/' || pathname === '/index.html' || pathname === '/sw.js') return 'no-cache';
  if (/\.(css|js)$/.test(pathname)) return 'no-cache';
  if (pathname.startsWith('/img/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

const VERSIONED = ['/app.js', '/styles.css', '/baker.js'];

const assetVersion = async (rel) => {
  try {
    const s = await stat(join(PUBLIC_DIR, rel));
    return String(Math.round(s.mtimeMs));
  } catch {
    return '1';
  }
};

/**
 * Stamp code references with the file's mtime. Without this the browser is
 * free to serve a month-old app.js out of its own cache, and a fix that never
 * reaches the screen is worse than no fix at all.
 */
const stampVersions = async (html) => {
  let out = html;
  for (const rel of VERSIONED) {
    const v = await assetVersion(rel);
    out = out.replaceAll(`"${rel}"`, `"${rel}?v=${v}"`);
  }
  return out;
};

const serveStatic = async (req, res, pathname) => {
  const isShared = pathname === '/shared/pricing.js';
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = isShared
    ? join(ROOT, 'src', 'pricing.js')
    : join(PUBLIC_DIR, rel === '/' || rel === '\\' ? 'index.html' : rel);

  try {
    let body = await readFile(file);
    if (pathname === '/' || pathname === '/index.html' || pathname === '/baker' || pathname === '/baker.html') {
      body = Buffer.from(await stampVersions(body.toString('utf8')));
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': cacheControl(pathname, isShared),
    });
    res.end(body);
  } catch {
    if (pathname === '/baker') {
      const body = await readFile(join(PUBLIC_DIR, 'baker.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(body);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
};

/* ------------------------------------------------------------------ server */

seed();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const [route, handler] of Object.entries(api)) {
    const [method, pattern] = route.split(' ');
    if (method !== req.method) continue;

    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let match = true;
    for (let i = 0; i < patternParts.length; i += 1) {
      const p = patternParts[i];
      if (p.startsWith(':')) params[p.slice(1)] = pathParts[i];
      else if (p !== pathParts[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    try {
      await handler(req, res, params, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something broke on our side.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'No such endpoint.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Crumb running at http://localhost:${PORT}`);
  console.log(`Baker view: http://localhost:${PORT}/baker  (key: ${BAKER_KEY})`);
});
