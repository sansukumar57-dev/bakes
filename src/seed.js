import { db, nowIso, todayStr, makeCode } from './db.js';
import { addDays, priceFor } from './pricing.js';

/**
 * Fictional baker, fictional cakes. Nothing here is a claim about a real shop —
 * the pilot trades under "Crumb, HSR Layout" and the numbers are invented.
 */
const CAKES = [
  {
    slug: 'vanilla-bean',
    name: 'Classic Vanilla Bean',
    tagline: 'The one everybody asks for',
    description:
      'Madagascar vanilla, a soft crumb, and fresh cream whipped the morning of collection. Keeps two days refrigerated.',
    pricePerKg: 900,
    minKg: 0.5,
    leadDays: 2,
    tags: 'eggless-available,bestseller',
    palette: { sponge: '#efdcbb', frosting: '#fdf8ee', accent: '#c2a04a' },
  },
  {
    slug: 'chocolate-truffle',
    name: 'Belgian Chocolate Truffle',
    tagline: 'Dark, dense, unapologetic',
    description:
      'Two layers of 64% couverture ganache over a buttermilk sponge. Rich enough that 500 g genuinely serves four.',
    pricePerKg: 1100,
    minKg: 0.5,
    leadDays: 2,
    tags: 'chocolate,bestseller',
    palette: { sponge: '#4a2c1d', frosting: '#6b3f2a', accent: '#d9b08c' },
  },
  {
    slug: 'strawberry-cream',
    name: 'Fresh Strawberry Cream',
    tagline: 'Only when strawberries are good',
    description:
      'No essence, no syrup — actual fruit between the layers. Slightly messy to cut, which is how you know.',
    pricePerKg: 1050,
    minKg: 1,
    leadDays: 3,
    tags: 'fruit,seasonal',
    palette: { sponge: '#f6d5d5', frosting: '#fff6f6', accent: '#c94f5c' },
  },
  {
    slug: 'red-velvet',
    name: 'Red Velvet',
    tagline: 'Cocoa, but make it dramatic',
    description: 'Buttermilk crumb with a whisper of cocoa and a cream cheese frosting that leans tart.',
    pricePerKg: 1000,
    minKg: 0.5,
    leadDays: 2,
    tags: 'eggless-available',
    palette: { sponge: '#7d1f2b', frosting: '#f6efe6', accent: '#b23a48' },
  },
  {
    slug: 'pistachio-rose',
    name: 'Pistachio & Rose',
    tagline: 'The one people photograph',
    description: 'Slivered pistachio folded through the sponge, a little rose in the cream. Grown-up, not sweet-sweet.',
    pricePerKg: 1250,
    minKg: 1,
    leadDays: 3,
    tags: 'nutty,celebration',
    palette: { sponge: '#dfe8cf', frosting: '#fbf7ef', accent: '#9caf88' },
  },
  {
    slug: 'lemon-blueberry',
    name: 'Lemon & Blueberry',
    tagline: 'Sharper than it looks',
    description: 'Lemon zest through the crumb, blueberries that collapse when you cut. Best eaten the same day.',
    pricePerKg: 1000,
    minKg: 0.5,
    leadDays: 2,
    tags: 'fruit',
    palette: { sponge: '#f2e6b4', frosting: '#fffdf4', accent: '#46578a' },
  },
  {
    slug: 'salted-caramel',
    name: 'Salted Caramel',
    tagline: 'The one that ruins diets',
    description: 'Burnt-sugar caramel cooked to the edge of bitter, then salted properly. Ribboned through, not drizzled on.',
    pricePerKg: 1150,
    minKg: 1,
    leadDays: 2,
    tags: 'chocolate,celebration',
    palette: { sponge: '#d9a566', frosting: '#f7ecd8', accent: '#8a5a2b' },
  },
  {
    slug: 'three-tier',
    name: 'Three-Tier Celebration',
    tagline: 'Weddings, engagements, big birthdays',
    description:
      'Three tiers, each a different cake from the list, dowelled and delivered assembled. Minimum 2 kg. We will not stack this the day you collect it.',
    pricePerKg: 1500,
    minKg: 2,
    leadDays: 5,
    tags: 'celebration,delivery-only',
    palette: { sponge: '#f0e6d8', frosting: '#fffaf3', accent: '#b08d57' },
  },
];

/**
 * Photography is real stock imagery (Unsplash), not this baker's cakes — the
 * footer says so. The illustrations in `public/app.js` remain as a fallback
 * if an image fails to load.
 */
const PHOTOS = {
  'vanilla-bean': ['vanilla-bean.jpg', 'A vanilla layer cake with white frosting and fresh raspberries'],
  'chocolate-truffle': ['chocolate-truffle.jpg', 'A chocolate layer cake with dark ganache dripping down the sides'],
  'strawberry-cream': ['strawberry-cream.jpg', 'Slices of strawberry cream cake layered with whipped cream and fresh strawberries'],
  'red-velvet': ['red-velvet.jpg', 'A red velvet cake with cream cheese frosting, one slice cut away'],
  'pistachio-rose': ['pistachio-rose.jpg', 'A pistachio cake with pale green frosting, scattered with rose petals and chopped nuts'],
  'lemon-blueberry': ['lemon-blueberry.jpg', 'A lemon layer cake on a cake stand, surrounded by fresh lemons'],
  'salted-caramel': ['salted-caramel.jpg', 'A white cake with caramel dripping down the sides on a cake stand'],
  'three-tier': ['three-tier.jpg', 'A tiered celebration cake decorated with fresh berries and flowers'],
};

for (const c of CAKES) {
  const [image, imageAlt] = PHOTOS[c.slug] || ['', ''];
  c.image = image;
  c.imageAlt = imageAlt;
}

const seedCakes = () => {
  const insert = db.prepare(`
    INSERT INTO cakes (slug, name, tagline, description, price_per_kg, min_kg, lead_days, tags, palette, image, image_alt, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      tagline = excluded.tagline,
      description = excluded.description,
      price_per_kg = excluded.price_per_kg,
      min_kg = excluded.min_kg,
      lead_days = excluded.lead_days,
      tags = excluded.tags,
      palette = excluded.palette,
      image = excluded.image,
      image_alt = excluded.image_alt,
      position = excluded.position
  `);

  CAKES.forEach((c, i) => {
    insert.run(
      c.slug,
      c.name,
      c.tagline,
      c.description,
      c.pricePerKg,
      c.minKg,
      c.leadDays,
      c.tags,
      JSON.stringify(c.palette),
      c.image,
      c.imageAlt,
      i,
    );
  });
};

/**
 * Demo pressure, so the calendar has something honest to show on day one.
 * Three orders placed on the same Saturday, which pushes it to "1 slot left".
 */
const seedPressure = (today) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM cakes').get();
  if (count.n === 0) return;

  const existing = db.prepare('SELECT COUNT(*) AS n FROM orders').get();
  if (existing.n > 0) return;

  const cake = db.prepare('SELECT * FROM cakes ORDER BY position LIMIT 1').get();
  if (!cake) return;

  const target = addDays(today, 6);
  const insert = db.prepare(`
    INSERT INTO orders (code, cake_id, size_kg, eggless, candles, inscription, wanted_date, slot, fulfilment,
                        name, phone, address, total, deposit, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
  `);

  for (let i = 0; i < 5; i += 1) {
    const price = priceFor({ pricePerKg: cake.price_per_kg }, { kg: 1, eggless: i % 2 === 0 });
    insert.run(
      makeCode(),
      cake.id,
      1,
      i % 2 === 0 ? 1 : 0,
      0,
      i === 0 ? 'Happy birthday, Amma' : '',
      target,
      i % 2 === 0 ? '10:00–13:00' : '16:00–19:00',
      'pickup',
      `Demo order ${i + 1}`,
      '9800000000',
      '',
      price.total,
      price.deposit,
      nowIso(),
    );
  }

  // One date the baker is genuinely away, so "closed" is not theoretical.
  db.prepare('INSERT OR REPLACE INTO day_overrides (date, slots, closed, reason) VALUES (?, NULL, 1, ?)').run(
    addDays(today, 10),
    'Baker is away for a family function',
  );
};

export const seed = () => {
  seedCakes();
  seedPressure(todayStr());
};

const isCli = process.argv[1] && process.argv[1].endsWith('seed.js');

if (isCli) {
  if (process.argv.includes('--reset')) {
    db.exec('DELETE FROM orders; DELETE FROM cakes; DELETE FROM day_overrides;');
    console.log('Cleared cakes, orders and date overrides.');
  }
  seed();
  const cakes = db.prepare('SELECT COUNT(*) AS n FROM cakes').get().n;
  const orders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  console.log(`Seeded ${cakes} cakes and ${orders} orders.`);
  console.log(`Database: ${db.location ? db.location() : 'data/crumb.db'}`);
}

export default seed;
