# Crumb

A storefront for one home baker. The product's spine is a **date-feasibility engine**: every cake has a real notice period, the baker has a real daily limit, and every date in the next three weeks gets a verdict in words — `open`, `limited`, `full`, `closed`, or `too_soon` — instead of a silently disabled button.

> **This is a demo.** Crumb, its cakes, prices, dates and orders are fictional. There is no shop, no payment processor and no real customer data.

## Run it

```powershell
cd cake-shop
npm start          # http://localhost:4174
```

Zero dependencies, no build step. Requires Node 22.5+ (uses the built-in `node:sqlite`).

```powershell
npm run seed       # 8 cakes + demo pressure on the calendar
npm run reset      # wipe and re-seed
npm test           # 18 unit tests over pricing, availability and validation
npm run smoke      # 23 end-to-end checks against a running server
```

The seeded demo does two things on purpose: it books one weekday past its capacity so you can see a `full` day, and it closes one date so you can see a `closed` day with a reason.

## The one idea worth keeping

Most cake-ordering flows are optimistic: pick a cake, pick a date, and only later does a human say "sorry, that day is gone". Crumb inverts it.

- Each cake carries `lead_days`. A three-tier cake cannot be made in 48 hours, so dates inside that window are refused with the earliest legal date named.
- Each day carries a capacity (4 on weekdays, 6 on weekends), overridable per date.
- Capacity is claimed inside a `BEGIN IMMEDIATE` transaction at order time, so two people tapping *Place order* on the last slot cannot both win — the loser gets a 409 with a human sentence, not a stack trace.

The rules live in `src/pricing.js` with no I/O and no clock. The server imports it, and the browser imports the same file over `/shared/pricing.js`, so the price on screen and the price in the database can't drift apart.

Two details that are easy to get wrong, and are therefore pinned by tests:

- A cake's notice period is per cake. A three-tier celebration needs five days, a sponge needs two. The calendar is built from `leadDays`, and the rule accepts either `leadDays` or a raw row's `lead_days` so a caller cannot quietly fall back to a default.
- Capacity is claimed inside a `BEGIN IMMEDIATE` transaction, so two people tapping *Place order* on the last slot cannot both win — the loser gets a 409 with a human sentence, not a stack trace.

## Keeping the browser honest

A demo is only worth looking at if the screen matches the code. Three things guard that:

- Code is served with `no-cache`, and the HTML stamps `/app.js` and `/styles.css` with the file's mtime, so a fix cannot hide behind a cached copy.
- The service worker is network-first for everything except `/img/`, and it never answers requests for its own script — a worker that serves its own file can never update itself.
- `/api/` is never cached at all. A stale price or a stale calendar is worse than an offline page.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/cakes` | catalogue with palettes and size options |
| GET | `/api/cakes/:slug` | one cake + its 21-day calendar |
| POST | `/api/orders` | 201 with a code, 422 with a list of sentences, 409 if the slot went |
| GET | `/api/orders/:code` | lookup without an account |
| GET | `/api/baker/orders?key=` | all orders, grouped by date |
| POST | `/api/baker/orders/:id?key=` | set `new` / `baking` / `ready` / `done` / `cancelled` |

Baker view: `/baker` — demo key `crumb-demo`, overridable with `CRUMB_BAKER_KEY`.

## What it deliberately does not do

- **No accounts.** The order code is the credential. That is the right trade for a one-baker shop and the wrong one for a marketplace.
- **No basket.** One cake per order, because a home oven has one schedule.
- **No payment.** The deposit is calculated and stated; collection happens by UPI after the baker confirms by phone.
- **No photography of the baker's own cakes.** The photographs are stock images from Unsplash; the SVG illustrations in `public/app.js` remain as a fallback if an image fails to load.

## Layout

```
server.js            HTTP routes, static files, atomic capacity claim
src/db.js            schema, date helpers, order codes
src/pricing.js       pure pricing + calendar + validation (shared with the browser)
src/seed.js          fictional catalogue, photographs and demo pressure
public/              storefront, builder, receipt, tracking, baker view, PWA
public/img/          the eight photographs
test/pricing.test.js the rules, pinned
test/smoke.mjs       end-to-end checks against a running server
```

## Credits

Photographs are stock images from [Unsplash](https://unsplash.com), used under the
Unsplash License. The baker, the cakes, the prices, the dates and every order in
this project are invented.

