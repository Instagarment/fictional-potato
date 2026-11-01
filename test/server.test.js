import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';
import { fakeShops, fakeStore, makeOrder, quietLog, tracking } from './helpers.js';

const clientId = 'client-123';
const clientSecret = 'secret-456';

function idTokenFor(shop) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: clientId, exp: now + 60, nbf: now - 1 }),
  ).toString('base64url');
  const s = crypto.createHmac('sha256', clientSecret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

async function start() {
  const store = fakeStore({ 'brand-a.myshopify.com': makeOrder() }, { shopNames: { 'brand-a.myshopify.com': 'Brand A' } });
  const shops = fakeShops({});
  const sent = [];
  const config = {
    appName: 'Instagarment Print on Demand',
    companyName: 'Instagarment',
    appUrl: 'https://example.test',
    shopify: { clientId, clientSecret },
    tracking,
    email: { to: ['orders@instagarment.test'] },
    admin: { password: 'pw' },
  };
  const { app } = createApp({
    config,
    shopify: { graphql: store.graphql },
    shops,
    mailer: { sendPrintAlert: async (x) => sent.push(x) },
    log: quietLog,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, store, shops, sent };
}

function webhook(base, topic, shop, body) {
  const raw = JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', clientSecret).update(raw).digest('base64');
  return fetch(`${base}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Topic': topic, 'X-Shopify-Shop-Domain': shop, 'X-Shopify-Hmac-Sha256': hmac },
    body: raw,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 50));

test('full flow: order webhook → store registered → email → queue → uninstall → redact', async (t) => {
  const { base, server, store, shops, sent } = await start();
  t.after(() => server.close());

  // Forged webhook is refused
  const forged = await fetch(`${base}/webhooks`, {
    method: 'POST',
    headers: { 'X-Shopify-Topic': 'orders/create', 'X-Shopify-Shop-Domain': 'brand-a.myshopify.com', 'X-Shopify-Hmac-Sha256': 'bad' },
    body: '{}',
  });
  assert.equal(forged.status, 401);

  // Real order arrives
  const res = await webhook(base, 'orders/create', 'brand-a.myshopify.com', { id: 1001, admin_graphql_api_id: 'gid://shopify/Order/1001' });
  assert.equal(res.status, 200);
  await settle();
  assert.equal(shops.get('brand-a.myshopify.com').name, 'Brand A');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].shopName, 'Brand A');
  assert.deepEqual(store.orders['brand-a.myshopify.com'].tags, ['instagarment-to-print']);

  // Admin queue needs the password, then shows the order with the store name
  assert.equal((await fetch(`${base}/admin`)).status, 401);
  const auth = { Authorization: 'Basic ' + Buffer.from('x:pw').toString('base64') };
  const page = await (await fetch(`${base}/admin`, { headers: auth })).text();
  assert.match(page, /Brand A/);
  assert.match(page, /Sunset Tee/);

  // Mark printed from the admin page
  const done = await fetch(`${base}/admin/orders/brand-a.myshopify.com/1001/items`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'lineItemId=1&printed=true',
    redirect: 'manual',
  });
  assert.equal(done.status, 303);
  assert.deepEqual(store.orders['brand-a.myshopify.com'].tags, ['instagarment-printed']);

  // Compliance webhooks are acknowledged
  assert.equal((await webhook(base, 'customers/data_request', 'brand-a.myshopify.com', { customer: { id: 1 } })).status, 200);
  assert.equal((await webhook(base, 'customers/redact', 'brand-a.myshopify.com', { customer: { id: 1 } })).status, 200);

  // Uninstall → store marked, then shop/redact → removed
  await webhook(base, 'app/uninstalled', 'brand-a.myshopify.com', {});
  await settle();
  assert.ok(shops.get('brand-a.myshopify.com').uninstalledAt);
  await webhook(base, 'shop/redact', 'brand-a.myshopify.com', {});
  await settle();
  assert.equal(shops.get('brand-a.myshopify.com'), null);
});

test('store owner page: requires a Shopify ID token, adds and removes products', async (t) => {
  const { base, server, store } = await start();
  t.after(() => server.close());

  const html = await (await fetch(`${base}/app?shop=brand-a.myshopify.com`)).text();
  assert.match(html, /Instagarment Print on Demand/);
  assert.match(html, /shopify-api-key" content="client-123"/);

  const csp = (await fetch(`${base}/app?shop=brand-a.myshopify.com`)).headers.get('content-security-policy');
  assert.equal(csp, 'frame-ancestors https://admin.shopify.com https://brand-a.myshopify.com;');

  const noAuth = await fetch(`${base}/api/overview`);
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.get('x-shopify-retry-invalid-session-request'), '1');

  const headers = { Authorization: `Bearer ${idTokenFor('brand-a.myshopify.com')}`, 'Content-Type': 'application/json' };
  await fetch(`${base}/api/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids: ['gid://shopify/Product/77', 'not-an-id'], tracked: true }),
  });
  let overview = await (await fetch(`${base}/api/overview`, { headers })).json();
  assert.deepEqual(overview.products.map((p) => p.id), ['gid://shopify/Product/77']);

  await fetch(`${base}/api/products`, { method: 'POST', headers, body: JSON.stringify({ ids: ['gid://shopify/Product/77'], tracked: false }) });
  overview = await (await fetch(`${base}/api/overview`, { headers })).json();
  assert.deepEqual(overview.products, []);

  // A token for a different store only ever touches that store
  const other = { Authorization: `Bearer ${idTokenFor('brand-b.myshopify.com')}`, 'Content-Type': 'application/json' };
  await fetch(`${base}/api/products`, { method: 'POST', headers: other, body: JSON.stringify({ ids: ['gid://shopify/Product/5'], tracked: true }) });
  assert.equal(store.products['brand-a.myshopify.com']['gid://shopify/Product/5'], undefined);
});
