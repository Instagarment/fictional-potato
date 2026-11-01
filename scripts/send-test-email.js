// Sends a sample alert so you can check your email settings.
// Run with:  npm run test-email
import { loadConfig } from '../src/config.js';
import { createMailer } from '../src/email.js';

const config = loadConfig();
const mailer = createMailer({ email: config.email, shopDomain: config.shopify.shopDomain, appUrl: config.appUrl });
if (!mailer) process.exit(1);

await mailer.verify();
await mailer.sendPrintAlert(
  {
    name: '#TEST',
    legacyResourceId: '0',
    note: 'This is a test email from Print Tracker.',
    shippingAddress: { name: 'Sample Customer', city: 'Austin', provinceCode: 'TX', countryCodeV2: 'US' },
    shippingLine: { title: 'Standard' },
  },
  [
    {
      title: 'Sample Design Tee',
      variantTitle: 'Black / L',
      sku: 'POD-SAMPLE-BLK-L',
      currentQuantity: 2,
      customAttributes: [{ key: 'Name on back', value: 'ALEX' }],
      image: null,
    },
  ],
);
console.log(`Test email sent to ${config.email.to.join(', ')}`);
