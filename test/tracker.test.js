import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, isTrackedItem, trackedItems } from '../src/tracker.js';
import { renderAlert } from '../src/email.js';
import { queuePage, picklistPage } from '../src/views.js';
import { fakeShops, makeOrder, lineItem, fakeStore, quietLog, tracking } from './helpers.js';

test('only products with the instagarment tag count (case-insensitive)', () => {
  const order = makeOrder();
  const [tee, hoodie] = order.lineItems.nodes;
  assert.equal(isTrackedItem(tee, tracking), true);
  assert.equal(isTrackedItem(hoodie, tracking), false);
  assert.deepEqual(trackedItems(order, tracking).map((i) => i.title), ['Sunset Tee']);
});

test('items removed from the order are ignored', () => {
  const order = makeOrder();
  order.lineItems.nodes[0].currentQuantity = 0;
  assert.equal(trackedItems(order, tracking).length, 0);
});

test('new order is tagged and emailed exactly once, with the store name', async () => {
  const store = fakeStore({ 'a.myshopify.com': makeOrder() });
  const sent = [];
  const mailer = { sendPrintAlert: async (x) => sent.push(x) };
  const shops = fakeShops({ 'a.myshopify.com': 'Brand A' });
  const tracker = createTracker({ graphql: store.graphql, shops, tracking, mailer, log: quietLog });

  const first = await tracker.processOrder('a.myshopify.com', 'gid://shopify/Order/1001');
  assert.equal(first.status, 'tracked');
  assert.deepEqual(store.orders['a.myshopify.com'].tags, ['instagarment-to-print']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].shopName, 'Brand A');

  const tracker2 = createTracker({ graphql: store.graphql, shops, tracking, mailer, log: quietLog });
  assert.equal((await tracker2.processOrder('a.myshopify.com', 'gid://shopify/Order/1001')).status, 'already-tracked');
  assert.equal(sent.length, 1);
});

test('orders with none of our products are left alone', async () => {
  const order = makeOrder({ lineItems: { nodes: [lineItem(2, { tags: [] })] } });
  const store = fakeStore({ 'a.myshopify.com': order });
  const tracker = createTracker({ graphql: store.graphql, shops: fakeShops({ 'a.myshopify.com': 'A' }), tracking, mailer: null, log: quietLog });
  assert.equal((await tracker.processOrder('a.myshopify.com', order.id)).status, 'no-items');
  assert.deepEqual(order.tags, []);
});

test('cancelled orders are skipped', async () => {
  const store = fakeStore({ 'a.myshopify.com': makeOrder({ cancelledAt: '2026-11-01T13:00:00Z' }) });
  const tracker = createTracker({ graphql: store.graphql, shops: fakeShops({ 'a.myshopify.com': 'A' }), tracking, mailer: null, log: quietLog });
  assert.equal((await tracker.processOrder('a.myshopify.com', 'gid://shopify/Order/1001')).status, 'cancelled');
});

test('marking printed swaps the tags, undo swaps them back', async () => {
  const order = makeOrder({
    tags: ['instagarment-to-print'],
    lineItems: { nodes: [lineItem(1, { tags: ['instagarment'] }), lineItem(3, { tags: ['instagarment'], title: 'Mug' })] },
  });
  const store = fakeStore({ 'a.myshopify.com': order });
  const tracker = createTracker({ graphql: store.graphql, shops: fakeShops({ 'a.myshopify.com': 'A' }), tracking, mailer: null, log: quietLog });

  assert.equal((await tracker.setPrinted('a.myshopify.com', order.id, ['1'], true)).allDone, false);
  assert.deepEqual(order.tags, ['instagarment-to-print']);
  assert.equal((await tracker.setPrinted('a.myshopify.com', order.id, ['3'], true)).allDone, true);
  assert.deepEqual(order.tags, ['instagarment-printed']);
  assert.equal((await tracker.setPrinted('a.myshopify.com', order.id, ['3'], false)).allDone, false);
  assert.deepEqual(order.tags, ['instagarment-to-print']);
});

test('queue combines every store and keeps going if one store fails', async () => {
  const store = fakeStore({
    'a.myshopify.com': makeOrder({ tags: ['instagarment-to-print'], createdAt: '2026-11-01T10:00:00Z' }),
    'b.myshopify.com': makeOrder({ tags: ['instagarment-to-print'], name: '#2001', createdAt: '2026-11-01T09:00:00Z' }),
  });
  const graphql = async (shop, q, v) => {
    if (shop === 'c.myshopify.com') throw new Error('app uninstalled');
    return store.graphql(shop, q, v);
  };
  const shops = fakeShops({ 'a.myshopify.com': 'Brand A', 'b.myshopify.com': 'Brand B', 'c.myshopify.com': 'Brand C' });
  const tracker = createTracker({ graphql, shops, tracking, mailer: null, log: quietLog });
  const { queue, errors } = await tracker.getQueue();
  assert.deepEqual(queue.map((q) => `${q.shopName} ${q.order.name}`), ['Brand B #2001', 'Brand A #1001']);
  assert.deepEqual(errors.map((x) => x.shopName), ['Brand C']);
});

test('email and pages render and escape customer text', () => {
  const order = makeOrder({ note: '<script>alert(1)</script>' });
  const items = trackedItems(order, tracking);
  const { html, text } = renderAlert({ shopName: 'Brand A', order, items, appUrl: 'https://app.example' });
  assert.match(html, /Brand A/);
  assert.match(html, /ALEX/);
  assert.match(html, /https:\/\/app\.example\/logo\.png/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(text, /1 × Sunset Tee — Black \/ L/);

  const entry = { shop: 'a.myshopify.com', shopName: 'Brand A', order, items };
  const page = queuePage({ queue: [entry], errors: [] });
  assert.match(page, /Mark all printed/);
  assert.match(page, /\/admin\/orders\/a\.myshopify\.com\/1001\/items/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(picklistPage({ queue: [entry], errors: [] }), /Sunset Tee/);
});
