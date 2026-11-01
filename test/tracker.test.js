import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTracker, isTrackedItem, trackedItems } from '../src/tracker.js';
import { verifyWebhook } from '../src/shopify.js';
import { renderAlert } from '../src/email.js';
import { queuePage, picklistPage } from '../src/views.js';

const tracking = { productTag: 'print-on-demand', skuPrefixes: ['POD-'], toPrintTag: 'needs-printing', printedTag: 'printed' };

function lineItem(id, { tags = [], sku = '', qty = 1, title = 'Tee', attrs = [] } = {}) {
  return {
    id: `gid://shopify/LineItem/${id}`,
    title,
    variantTitle: 'Black / L',
    sku,
    quantity: qty,
    currentQuantity: qty,
    customAttributes: attrs,
    image: null,
    product: { id: `gid://shopify/Product/${id}`, tags },
  };
}

function makeOrder(overrides = {}) {
  return {
    id: 'gid://shopify/Order/1001',
    legacyResourceId: '1001',
    name: '#1001',
    createdAt: '2026-11-01T12:00:00Z',
    cancelledAt: null,
    tags: [],
    note: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    customer: { displayName: 'Sam Rivera' },
    shippingAddress: { name: 'Sam Rivera', city: 'Austin', provinceCode: 'TX', countryCodeV2: 'US' },
    shippingLine: { title: 'Standard' },
    metafield: null,
    lineItems: {
      nodes: [
        lineItem(1, { tags: ['Print-On-Demand'], title: 'Sunset Tee', attrs: [{ key: 'Name', value: 'ALEX' }] }),
        lineItem(2, { tags: ['in-stock'], title: 'Plain Hoodie' }),
        lineItem(3, { sku: 'pod-mug-01', title: 'Mug' }),
      ],
    },
    ...overrides,
  };
}

// A pretend Shopify that keeps one order in memory and handles the calls the tracker makes.
function fakeShopify(order) {
  const calls = [];
  return {
    calls,
    order,
    async graphql(query, vars) {
      calls.push(query.match(/(query|mutation) (\w+)/)?.[2]);
      if (query.includes('query Order(')) return { order: this.order };
      if (query.includes('tagsAdd')) {
        for (const t of vars.tags) if (!this.order.tags.includes(t)) this.order.tags.push(t);
        return { tagsAdd: { userErrors: [] } };
      }
      if (query.includes('tagsRemove')) {
        this.order.tags = this.order.tags.filter((t) => !vars.tags.includes(t));
        return { tagsRemove: { userErrors: [] } };
      }
      if (query.includes('metafieldsSet')) {
        this.order.metafield = { value: vars.metafields[0].value };
        return { metafieldsSet: { userErrors: [] } };
      }
      if (query.includes('query Orders(')) {
        return { orders: { nodes: [this.order], pageInfo: { hasNextPage: false, endCursor: null } } };
      }
      throw new Error('unexpected query ' + query);
    },
  };
}

const quietLog = { info() {}, error() {}, warn() {} };

test('matches products by tag (case-insensitive) or SKU prefix', () => {
  const order = makeOrder();
  const [tee, hoodie, mug] = order.lineItems.nodes;
  assert.equal(isTrackedItem(tee, tracking), true);
  assert.equal(isTrackedItem(hoodie, tracking), false);
  assert.equal(isTrackedItem(mug, tracking), true);
  assert.deepEqual(trackedItems(order, tracking).map((i) => i.title), ['Sunset Tee', 'Mug']);
});

test('ignores items that were removed from the order', () => {
  const order = makeOrder();
  order.lineItems.nodes[0].currentQuantity = 0;
  assert.deepEqual(trackedItems(order, tracking).map((i) => i.title), ['Mug']);
});

test('new order with POD items is tagged and emailed exactly once', async () => {
  const shopify = fakeShopify(makeOrder());
  const sent = [];
  const mailer = { sendPrintAlert: async (order, items) => sent.push({ order, items }) };
  const tracker = createTracker({ shopify, tracking, mailer, log: quietLog });

  const first = await tracker.processOrder('gid://shopify/Order/1001');
  assert.equal(first.status, 'tracked');
  assert.deepEqual(shopify.order.tags, ['needs-printing']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].items.length, 2);

  // Shopify retries the webhook — no second email.
  const tracker2 = createTracker({ shopify, tracking, mailer, log: quietLog });
  const again = await tracker2.processOrder('gid://shopify/Order/1001');
  assert.equal(again.status, 'already-tracked');
  assert.equal(sent.length, 1);
});

test('orders with no POD items are left alone', async () => {
  const order = makeOrder({ lineItems: { nodes: [lineItem(2, { tags: ['in-stock'] })] } });
  const shopify = fakeShopify(order);
  const sent = [];
  const tracker = createTracker({ shopify, tracking, mailer: { sendPrintAlert: async () => sent.push(1) }, log: quietLog });
  const result = await tracker.processOrder(order.id);
  assert.equal(result.status, 'no-pod-items');
  assert.deepEqual(order.tags, []);
  assert.equal(sent.length, 0);
});

test('cancelled orders are skipped', async () => {
  const shopify = fakeShopify(makeOrder({ cancelledAt: '2026-11-01T13:00:00Z' }));
  const tracker = createTracker({ shopify, tracking, mailer: null, log: quietLog });
  assert.equal((await tracker.processOrder('gid://shopify/Order/1001')).status, 'cancelled');
});

test('marking items printed moves the order from needs-printing to printed, and undo moves it back', async () => {
  const shopify = fakeShopify(makeOrder({ tags: ['needs-printing'] }));
  const tracker = createTracker({ shopify, tracking, mailer: null, log: quietLog });

  let r = await tracker.setPrinted(shopify.order.id, ['1'], true);
  assert.equal(r.allDone, false);
  assert.deepEqual(shopify.order.tags, ['needs-printing']);

  r = await tracker.setPrinted(shopify.order.id, ['gid://shopify/LineItem/3'], true);
  assert.equal(r.allDone, true);
  assert.deepEqual(shopify.order.tags, ['printed']);
  assert.deepEqual(JSON.parse(shopify.order.metafield.value).sort(), ['1', '3']);

  r = await tracker.setPrinted(shopify.order.id, ['3'], false);
  assert.equal(r.allDone, false);
  assert.deepEqual(shopify.order.tags, ['needs-printing']);
});

test('queue shows printed flags per item', async () => {
  const shopify = fakeShopify(makeOrder({ tags: ['needs-printing'], metafield: { value: '["1"]' } }));
  const tracker = createTracker({ shopify, tracking, mailer: null, log: quietLog });
  const queue = await tracker.getQueue();
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].items.map((i) => i.printed), [true, false]);
});

test('webhook signature check', () => {
  const secret = 'shh';
  const body = Buffer.from('{"id":1}');
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyWebhook(body, good, secret), true);
  assert.equal(verifyWebhook(body, good, 'wrong'), false);
  assert.equal(verifyWebhook(Buffer.from('{"id":2}'), good, secret), false);
  assert.equal(verifyWebhook(body, undefined, secret), false);
});

test('email and pages render and escape customer text', () => {
  const order = makeOrder({ note: '<script>alert(1)</script>' });
  const items = trackedItems(order, tracking);
  const { html, text } = renderAlert({ order, items, orderUrl: 'https://admin.shopify.com/store/x/orders/1001', appUrl: 'https://app.example' });
  assert.match(html, /Sunset Tee/);
  assert.match(html, /ALEX/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(text, /1 × Sunset Tee — Black \/ L/);

  const page = queuePage({ shopDomain: 'x.myshopify.com', queue: [{ order, items }] });
  assert.match(page, /Mark all printed/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(picklistPage({ queue: [{ order, items }] }), /Sunset Tee/);
});
