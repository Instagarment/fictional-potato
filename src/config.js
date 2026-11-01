// All settings come from environment variables (or a .env file — see .env.example).
import fs from 'node:fs';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required setting ${name}. See .env.example for what it should be.`);
  }
  return value;
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Optional: bring your own private key. If neither is set, the app creates and
// stores its own key in DATA_DIR (see src/keys.js).
function loadPrivateKey() {
  if (process.env.SHOPIFY_PRIVATE_KEY) {
    // Hosting dashboards sometimes turn newlines into "\n" — undo that.
    return process.env.SHOPIFY_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  if (process.env.SHOPIFY_PRIVATE_KEY_PATH) {
    return fs.readFileSync(process.env.SHOPIFY_PRIVATE_KEY_PATH, 'utf8');
  }
  return null;
}

export function loadConfig({ needShopify = true } = {}) {
  return {
    appName: process.env.APP_NAME || 'Instagarment Print on Demand',
    companyName: process.env.COMPANY_NAME || 'Instagarment',
    port: Number(process.env.PORT || 3000),
    appUrl: (process.env.APP_URL || '').replace(/\/$/, ''),
    dataDir: process.env.DATA_DIR || './data',

    shopify: needShopify
      ? {
          clientId: required('SHOPIFY_CLIENT_ID'),
          clientSecret: required('SHOPIFY_CLIENT_SECRET'),
          keyId: process.env.SHOPIFY_KEY_ID || null,
          privateKey: loadPrivateKey(),
          apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
        }
      : null,

    tracking: {
      // Products with this tag are the ones Instagarment prints. Your customers
      // pick them inside the app, which adds the tag for them.
      productTag: process.env.TRACK_PRODUCT_TAG || 'instagarment',
      // Tags put on your customers' orders so everyone can filter by them in Shopify.
      toPrintTag: process.env.ORDER_TAG_TO_PRINT || 'instagarment-to-print',
      printedTag: process.env.ORDER_TAG_PRINTED || 'instagarment-printed',
    },

    email: {
      to: list(process.env.ALERT_EMAIL_TO),
      from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
      smtp: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },

    // Every N minutes, double-check the last day of orders in every store for
    // anything a webhook missed. 0 turns it off.
    catchUpMinutes: Number(process.env.CATCH_UP_MINUTES ?? 15),

    admin: {
      password: process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || '',
    },
  };
}
