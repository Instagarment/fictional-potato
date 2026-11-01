import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateSigningKey } from '../src/keys.js';
import { buildShopifyToml } from '../src/shopify-toml.js';

test('creates a signing key once, then reuses it; public JWK has no private parts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  const first = loadOrCreateSigningKey({ dataDir: dir });
  const second = loadOrCreateSigningKey({ dataDir: dir });
  assert.equal(first.keyId, second.keyId);
  assert.equal(first.privateKey, second.privateKey);
  assert.equal(first.jwk.alg, 'RS256');
  assert.equal(first.jwk.use, 'sig');
  for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(first.jwk[secret], undefined);
});

test('shopify.app.toml points Shopify at this app', () => {
  const toml = buildShopifyToml({ clientId: 'abc', appUrl: 'https://x.onrender.com', appName: 'Instagarment Print on Demand' });
  assert.match(toml, /application_url = "https:\/\/x\.onrender\.com\/app"/);
  assert.match(toml, /topics = \[ "orders\/create", "app\/uninstalled" \]/);
  assert.match(toml, /compliance_topics = \[ "customers\/data_request", "customers\/redact", "shop\/redact" \]/);
  assert.match(toml, /scopes = "read_orders,write_orders,write_products"/);
});
