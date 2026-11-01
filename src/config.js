// All settings come from environment variables (or a .env file — see .env.example).

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required setting ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const shopDomain = required('SHOPIFY_SHOP_DOMAIN')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  return {
    port: Number(process.env.PORT || 3000),
    appUrl: (process.env.APP_URL || '').replace(/\/$/, ''),

    shopify: {
      shopDomain,
      clientId: required('SHOPIFY_CLIENT_ID'),
      clientSecret: required('SHOPIFY_CLIENT_SECRET'),
      apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
    },

    tracking: {
      // A product counts as print-on-demand if it has this tag...
      productTag: process.env.TRACK_PRODUCT_TAG ?? 'print-on-demand',
      // ...or if the variant's SKU starts with one of these prefixes.
      skuPrefixes: list(process.env.TRACK_SKU_PREFIXES),
      // Tags this app puts on orders so you can filter them in Shopify admin too.
      toPrintTag: process.env.ORDER_TAG_TO_PRINT || 'needs-printing',
      printedTag: process.env.ORDER_TAG_PRINTED || 'printed',
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

    // Safety net: every N minutes, look for recent orders whose webhook never
    // arrived (e.g. the server was asleep) and alert for them. 0 turns it off.
    catchUpMinutes: Number(process.env.CATCH_UP_MINUTES ?? 15),

    dashboard: {
      password: process.env.DASHBOARD_PASSWORD || '',
    },
  };
}
