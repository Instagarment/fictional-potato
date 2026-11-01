import crypto from 'node:crypto';
import express from 'express';
import { loadConfig } from './config.js';
import { createShopifyClient, verifyWebhook } from './shopify.js';
import { createTracker } from './tracker.js';
import { createMailer } from './email.js';
import { queuePage, picklistPage, printedPage, messagePage } from './views.js';

const config = loadConfig();
const shopify = createShopifyClient(config.shopify);
const mailer = createMailer({ email: config.email, shopDomain: config.shopify.shopDomain, appUrl: config.appUrl });
const tracker = createTracker({ shopify, tracking: config.tracking, mailer });

const app = express();
app.set('trust proxy', true);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Shopify webhook: a new order was placed --------------------------------
// The raw body is needed to check Shopify's signature, so this route is
// registered before any JSON body parsing.
app.post('/webhooks/orders-create', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const ok = verifyWebhook(req.body, req.get('X-Shopify-Hmac-Sha256'), config.shopify.clientSecret);
  if (!ok) {
    console.warn('Rejected a webhook with an invalid signature');
    return res.status(401).send('Invalid signature');
  }

  // Shopify wants a reply within a few seconds, so answer first, then work.
  res.status(200).send('OK');

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return console.warn('Webhook body was not valid JSON');
  }
  const orderGid = payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`;
  tracker
    .processOrder(orderGid, { notify: true })
    .catch((err) => console.error(`Failed to process order ${payload.name || orderGid}: ${err.message}`));
});

// ---- Dashboard (password protected) -----------------------------------------
function requirePassword(req, res, next) {
  const expected = config.dashboard.password;
  if (!expected) {
    return res
      .status(503)
      .send(messagePage('Set a password', 'Set DASHBOARD_PASSWORD in your settings to use the dashboard.'));
  }
  const [scheme, encoded] = (req.get('Authorization') || '').split(' ');
  const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Print Tracker"').status(401).send('Password required');
}

// Block form posts coming from other websites.
function sameOrigin(req, res, next) {
  const origin = req.get('Origin') || req.get('Referer');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('Host')) return res.status(403).send('Forbidden');
    } catch {
      return res.status(403).send('Forbidden');
    }
  }
  next();
}

const dash = express.Router();
dash.use(requirePassword);
dash.use(express.urlencoded({ extended: false }));

function flashFrom(req) {
  return typeof req.query.msg === 'string' ? req.query.msg.slice(0, 200) : '';
}

dash.get('/', async (req, res, next) => {
  try {
    const queue = await tracker.getQueue();
    res.send(queuePage({ shopDomain: config.shopify.shopDomain, queue, flash: flashFrom(req) }));
  } catch (err) {
    next(err);
  }
});

dash.get('/picklist', async (_req, res, next) => {
  try {
    res.send(picklistPage({ queue: await tracker.getQueue() }));
  } catch (err) {
    next(err);
  }
});

dash.get('/printed', async (_req, res, next) => {
  try {
    const printed = await tracker.getRecentlyPrinted(25);
    res.send(printedPage({ shopDomain: config.shopify.shopDomain, printed }));
  } catch (err) {
    next(err);
  }
});

dash.post('/orders/:orderId/items', sameOrigin, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.orderId)) return res.status(400).send('Bad order id');
    const ids = [].concat(req.body.lineItemId || []).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) return res.redirect(303, '/');
    const { allDone } = await tracker.setPrinted(
      `gid://shopify/Order/${req.params.orderId}`,
      ids,
      req.body.printed !== 'false',
    );
    res.redirect(303, allDone ? '/?msg=' + encodeURIComponent('Order finished — moved to Printed.') : '/');
  } catch (err) {
    next(err);
  }
});

dash.post('/scan', sameOrigin, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.body.days) || 30, 1), 60);
    const { checked, found } = await tracker.scanRecentOrders({ days, notify: false });
    res.redirect(303, '/?msg=' + encodeURIComponent(`Checked ${checked} order(s) — added ${found} to the print queue.`));
  } catch (err) {
    next(err);
  }
});

app.use(dash);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send(messagePage('Something went wrong', err.message));
});

app.listen(config.port, () => {
  console.log(`Print Tracker running on port ${config.port}`);
  console.log(`Tracking products tagged "${config.tracking.productTag}"` +
    (config.tracking.skuPrefixes.length ? ` or SKUs starting with ${config.tracking.skuPrefixes.join(', ')}` : ''));
  if (!config.appUrl) console.log('Tip: set APP_URL so alert emails can link to the print queue.');
});

if (config.catchUpMinutes > 0) {
  const catchUp = () =>
    tracker
      .scanRecentOrders({ days: 1, notify: true })
      .then(({ found }) => found && console.log(`Catch-up: found ${found} order(s) that were missed`))
      .catch((err) => console.error(`Catch-up check failed: ${err.message}`));
  setTimeout(catchUp, 30_000);
  setInterval(catchUp, config.catchUpMinutes * 60_000);
}
