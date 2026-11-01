// One-time setup: tells Shopify to send new orders to this app.
// Run with:  npm run register-webhook
import { loadConfig } from '../src/config.js';
import { createShopifyClient } from '../src/shopify.js';

const config = loadConfig();
if (!config.appUrl.startsWith('https://')) {
  console.error('Set APP_URL to your app\'s public https:// address first (e.g. https://my-print-tracker.onrender.com).');
  process.exit(1);
}

const shopify = createShopifyClient(config.shopify);
const uri = `${config.appUrl}/webhooks/orders-create`;

const existing = await shopify.graphql(`{
  webhookSubscriptions(first: 50, topics: [ORDERS_CREATE]) { nodes { id uri } }
}`);

const nodes = existing.webhookSubscriptions.nodes;
if (nodes.some((n) => n.uri === uri)) {
  console.log(`Already set up: new orders are sent to ${uri}`);
  process.exit(0);
}

for (const old of nodes.filter((n) => n.uri.endsWith('/webhooks/orders-create'))) {
  await shopify.graphql(
    `mutation Del($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`,
    { id: old.id },
  );
  console.log(`Removed old webhook pointing at ${old.uri}`);
}

const result = await shopify.graphql(
  `mutation Create($uri: String!) {
    webhookSubscriptionCreate(topic: ORDERS_CREATE, webhookSubscription: { uri: $uri, format: JSON }) {
      webhookSubscription { id uri }
      userErrors { field message }
    }
  }`,
  { uri },
);

const { userErrors, webhookSubscription } = result.webhookSubscriptionCreate;
if (userErrors.length) {
  console.error('Shopify said no:', userErrors.map((e) => e.message).join('; '));
  process.exit(1);
}
console.log(`Done! New orders will be sent to ${webhookSubscription.uri}`);
