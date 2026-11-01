// Writes shopify.app.toml, then you upload it to Shopify with:
//   npx @shopify/cli@latest app deploy
// Run:  npm run shopify-config   (on Render: in the Shell tab)
import fs from 'node:fs';
import { buildShopifyToml } from '../src/shopify-toml.js';

const clientId = process.env.SHOPIFY_CLIENT_ID;
const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

if (!clientId || !appUrl.startsWith('https://')) {
  console.error('SHOPIFY_CLIENT_ID and APP_URL (your https:// address) must be set first.');
  process.exit(1);
}

const toml = buildShopifyToml({
  clientId,
  appUrl,
  appName: process.env.APP_NAME || 'Instagarment Print on Demand',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
});
fs.writeFileSync('shopify.app.toml', toml);
console.log(toml);
console.log('Wrote shopify.app.toml. Next run:  npx @shopify/cli@latest app deploy');
