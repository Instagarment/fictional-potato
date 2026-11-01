import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.js';
import { createShopify, verifyWebhook, verifyIdToken, isShopDomain } from './shopify.js';
import { createShopStore } from './shops.js';
import { createTracker } from './tracker.js';
import { createMailer } from './email.js';
import { queuePage, picklistPage, printedPage, storesPage, setupPage, messagePage } from './views.js';
import { buildShopifyToml } from './shopify-toml.js';
import { loadOrCreateSigningKey } from './keys.js';
import { embeddedPage, privacyPage } from './embedded.js';

export function createApp({ config, shopify, shops, mailer, jwk = null, log = console }) {
  const tracker = createTracker({ graphql: shopify.graphql, shops, tracking: config.tracking, mailer, log });
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir, { maxAge: '1d', index: false }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/privacy', (_req, res) =>
    res.send(privacyPage({ appName: config.appName, companyName: config.companyName, contactEmail: config.email.to[0] })),
  );

  // Remember a store (and look up its display name the first time we see it).
  async function noteShop(shop) {
    const known = shops.get(shop);
    if (known && !known.uninstalledAt && known.name !== shop.replace(/\.myshopify\.com$/, '')) return;
    shops.upsert(shop);
    try {
      shops.upsert(shop, { name: await tracker.getShopName(shop) });
      if (!known || known.uninstalledAt) log.info(`New store connected: ${shops.get(shop).name} (${shop})`);
    } catch (err) {
      log.error(`Couldn't look up the name of ${shop}: ${err.message}`);
    }
  }

  // ---- Webhooks from Shopify ------------------------------------------------
  // One address for every topic. The raw body is needed to check the signature.
  app.post('/webhooks', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!verifyWebhook(req.body, req.get('X-Shopify-Hmac-Sha256'), config.shopify.clientSecret)) {
      log.warn('Rejected a webhook with an invalid signature');
      return res.status(401).send('Invalid signature');
    }
    const topic = req.get('X-Shopify-Topic');
    const shop = req.get('X-Shopify-Shop-Domain');
    res.status(200).send('OK'); // reply fast; do the work after

    let payload = {};
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      /* compliance pings can be empty */
    }
    if (!isShopDomain(shop)) return;

    const work = async () => {
      switch (topic) {
        case 'orders/create': {
          await noteShop(shop);
          const orderGid = payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`;
          await tracker.processOrder(shop, orderGid, { notify: true });
          break;
        }
        case 'app/uninstalled':
          shops.markUninstalled(shop);
          log.info(`Store uninstalled the app: ${shop}`);
          break;
        case 'shop/redact':
          shops.remove(shop);
          log.info(`Deleted all data for ${shop} (shop/redact)`);
          break;
        case 'customers/redact':
        case 'customers/data_request':
          // This app stores no customer data, so there's nothing to delete or export.
          log.info(`${topic} from ${shop}: no customer data is stored by this app`);
          break;
        default:
          log.info(`Ignored webhook ${topic} from ${shop}`);
      }
    };
    work().catch((err) => log.error(`Webhook ${topic} from ${shop} failed: ${err.message}`));
  });

  // ---- The page store owners see inside Shopify admin -----------------------
  app.get('/app', (req, res) => {
    const shop = String(req.query.shop || '');
    // Only let Shopify admin (for this store) show this page in a frame.
    res.set(
      'Content-Security-Policy',
      `frame-ancestors https://admin.shopify.com${isShopDomain(shop) ? ` https://${shop}` : ''};`,
    );
    res.send(
      embeddedPage({
        clientId: config.shopify.clientId,
        appName: config.appName,
        companyName: config.companyName,
        tracking: config.tracking,
      }),
    );
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use((req, res, next) => {
    try {
      const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
      req.shop = verifyIdToken(token, config.shopify);
      next();
    } catch {
      res.set('X-Shopify-Retry-Invalid-Session-Request', '1').status(401).json({ error: 'Please reload the app' });
    }
  });
  api.use(async (req, _res, next) => {
    await noteShop(req.shop);
    next();
  });

  api.get('/overview', async (req, res, next) => {
    try {
      const [products, orders] = await Promise.all([tracker.getTrackedProducts(req.shop), tracker.getShopOrders(req.shop)]);
      res.json({ products, orders });
    } catch (err) {
      next(err);
    }
  });

  api.post('/products', async (req, res, next) => {
    try {
      const ids = [].concat(req.body?.ids || []).filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)).slice(0, 250);
      await tracker.setProductsTracked(req.shop, ids, req.body?.tracked !== false);
      res.json({ ok: true, count: ids.length });
    } catch (err) {
      next(err);
    }
  });

  api.post('/scan', async (req, res, next) => {
    try {
      res.json(await tracker.scanRecentOrders({ days: 30, notify: true, shop: req.shop }));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', api);

  // ---- Instagarment's admin pages (password protected) ----------------------
  function requirePassword(req, res, next) {
    const expected = config.admin.password;
    if (!expected) {
      return res.status(503).send(messagePage('Set a password', 'Set ADMIN_PASSWORD in your settings to use the print queue.'));
    }
    const [scheme, encoded] = (req.get('Authorization') || '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Instagarment"').status(401).send('Password required');
  }

  // Block form posts that come from other websites.
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

  const admin = express.Router();
  admin.use(requirePassword);
  admin.use(express.urlencoded({ extended: false }));
  const flashFrom = (req) => (typeof req.query.msg === 'string' ? req.query.msg.slice(0, 200) : '');

  admin.get('/', async (req, res, next) => {
    try {
      const { queue, errors } = await tracker.getQueue();
      res.send(queuePage({ queue, errors, flash: flashFrom(req) }));
    } catch (err) {
      next(err);
    }
  });

  admin.get('/picklist', async (_req, res, next) => {
    try {
      res.send(picklistPage(await tracker.getQueue()));
    } catch (err) {
      next(err);
    }
  });

  admin.get('/printed', async (_req, res, next) => {
    try {
      res.send(printedPage({ printed: await tracker.getRecentlyPrinted(30) }));
    } catch (err) {
      next(err);
    }
  });

  admin.get('/stores', (_req, res) => {
    res.send(storesPage({ shops: shops.all().sort((a, b) => a.name.localeCompare(b.name)) }));
  });

  admin.post('/orders/:shop/:orderId/items', sameOrigin, async (req, res, next) => {
    try {
      const { shop, orderId } = req.params;
      if (!isShopDomain(shop) || !shops.get(shop) || !/^\d+$/.test(orderId)) return res.status(400).send('Bad request');
      const ids = [].concat(req.body.lineItemId || []).filter((id) => /^\d+$/.test(id));
      if (ids.length === 0) return res.redirect(303, '/admin');
      const { allDone } = await tracker.setPrinted(shop, `gid://shopify/Order/${orderId}`, ids, req.body.printed !== 'false');
      res.redirect(303, allDone ? '/admin?msg=' + encodeURIComponent('Order finished — moved to Printed.') : '/admin');
    } catch (err) {
      next(err);
    }
  });

  admin.post('/scan', sameOrigin, async (req, res, next) => {
    try {
      const days = Math.min(Math.max(Number(req.body.days) || 30, 1), 60);
      const { checked, found } = await tracker.scanRecentOrders({ days, notify: false });
      res.redirect(303, '/admin?msg=' + encodeURIComponent(`Checked ${checked} order(s) across all stores — added ${found} to the queue.`));
    } catch (err) {
      next(err);
    }
  });

  admin.get('/setup', (req, res) => {
    const toml = buildShopifyToml({
      clientId: config.shopify.clientId,
      appUrl: config.appUrl || 'https://YOUR-APP.onrender.com',
      appName: config.appName,
      apiVersion: config.shopify.apiVersion,
    });
    res.send(
      setupPage({
        appUrl: config.appUrl,
        jwk,
        toml,
        emailReady: !!mailer,
        storeCount: shops.active().length,
        flash: flashFrom(req),
      }),
    );
  });

  admin.post('/setup/test-email', sameOrigin, async (_req, res) => {
    let msg;
    try {
      await mailer.sendPrintAlert({
        shopName: 'Sample Store',
        order: { name: '#TEST', note: 'This is a test email from the Instagarment app.', shippingAddress: { name: 'Sample Customer', city: 'Austin', provinceCode: 'TX', countryCodeV2: 'US' }, shippingLine: { title: 'Standard' } },
        items: [{ title: 'Sample Design Tee', variantTitle: 'Black / L', sku: 'SAMPLE-BLK-L', currentQuantity: 2, customAttributes: [{ key: 'Name on back', value: 'ALEX' }], image: null }],
      });
      msg = `Test email sent to ${config.email.to.join(', ')}.`;
    } catch (err) {
      msg = `Couldn't send the test email: ${err.message}`;
    }
    res.redirect(303, '/admin/setup?msg=' + encodeURIComponent(msg));
  });

  app.use('/admin', admin);

  app.use((err, req, res, _next) => {
    log.error(err);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: err.message });
    res.status(500).send(messagePage('Something went wrong', err.message));
  });

  return { app, tracker };
}

// Start the server when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const signingKey = loadOrCreateSigningKey({
    dataDir: config.dataDir,
    privateKeyPem: config.shopify.privateKey,
    keyId: config.shopify.keyId,
  });
  config.shopify.privateKey = signingKey.privateKey;
  config.shopify.keyId = signingKey.keyId;
  const shopify = createShopify(config.shopify);
  const shops = createShopStore(config.dataDir);
  const mailer = createMailer({ email: config.email, appUrl: config.appUrl, companyName: config.companyName });
  const { app, tracker } = createApp({ config, shopify, shops, mailer, jwk: signingKey.jwk });

  app.listen(config.port, () => {
    console.log(`${config.appName} running on port ${config.port}`);
    console.log(`${shops.active().length} connected store(s). Products tagged "${config.tracking.productTag}" are tracked.`);
    if (!config.appUrl) console.log('Set APP_URL to this site\'s https:// address, then open /admin/setup.');
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
}
