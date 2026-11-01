import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClientAssertion, createShopify, verifyIdToken, verifyWebhook } from '../src/shopify.js';

const clientId = 'client-123';
const clientSecret = 'secret-456';

function idToken(claims, secret = clientSecret) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({
  iss: 'https://brand-a.myshopify.com/admin',
  dest: 'https://brand-a.myshopify.com',
  aud: clientId,
  sub: '42',
  exp: now() + 60,
  nbf: now() - 5,
  iat: now() - 5,
  jti: 'x',
});

test('webhook signature check', () => {
  const body = Buffer.from('{"id":1}');
  const good = crypto.createHmac('sha256', clientSecret).update(body).digest('base64');
  assert.equal(verifyWebhook(body, good, clientSecret), true);
  assert.equal(verifyWebhook(body, good, 'wrong'), false);
  assert.equal(verifyWebhook(Buffer.from('{"id":2}'), good, clientSecret), false);
  assert.equal(verifyWebhook(body, undefined, clientSecret), false);
});

test('ID token from Shopify admin is accepted and gives the shop', () => {
  assert.equal(verifyIdToken(idToken(goodClaims()), { clientId, clientSecret }), 'brand-a.myshopify.com');
});

test('bad ID tokens are rejected', () => {
  const opts = { clientId, clientSecret };
  assert.throws(() => verifyIdToken(idToken(goodClaims(), 'other-secret'), opts), /signature/);
  assert.throws(() => verifyIdToken(idToken({ ...goodClaims(), exp: now() - 120 }), opts), /expired/);
  assert.throws(() => verifyIdToken(idToken({ ...goodClaims(), aud: 'other-app' }), opts), /different app/);
  assert.throws(() => verifyIdToken(idToken({ ...goodClaims(), iss: 'https://evil.myshopify.com/admin' }), opts), /issuer/);
  assert.throws(() => verifyIdToken('nope', opts), /Malformed/);
});

test('client assertion is signed correctly for Shopify', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = createClientAssertion({ clientId, keyId: 'k1', privateKey }, 'brand-a.myshopify.com');
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual([header.alg, header.kid], ['RS256', 'k1']);
  assert.equal(claims.iss, clientId);
  assert.equal(claims.sub, clientId);
  assert.equal(claims.aud, 'https://brand-a.myshopify.com/admin/oauth/access_token');
  assert.ok(claims.exp - claims.iat <= 300);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')));

  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecJwt = createClientAssertion({ clientId, keyId: 'k2', privateKey: ec.privateKey }, 'brand-a.myshopify.com');
  const [eh, ep, es] = ecJwt.split('.');
  assert.equal(JSON.parse(Buffer.from(eh, 'base64url')).alg, 'ES256');
  assert.ok(crypto.verify('sha256', Buffer.from(`${eh}.${ep}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(es, 'base64url')));
});

test('gets a token per store, caches it, then calls the API', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const requests = [];
  const fetchImpl = async (url, opts) => {
    requests.push(url);
    if (url.endsWith('/admin/oauth/access_token')) {
      const body = new URLSearchParams(opts.body);
      assert.equal(body.get('grant_type'), 'client_credentials');
      assert.equal(body.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      assert.equal(body.get('client_secret'), null);
      return Response.json({ access_token: 'tok-' + new URL(url).host, expires_in: 3599 });
    }
    assert.equal(opts.headers['X-Shopify-Access-Token'], 'tok-' + new URL(url).host);
    return Response.json({ data: { shop: { name: 'A' } } });
  };
  const shopify = createShopify({ clientId, keyId: 'k1', privateKey: pem, apiVersion: '2026-10' }, { fetchImpl });
  await shopify.graphql('brand-a.myshopify.com', '{ shop { name } }');
  await shopify.graphql('brand-a.myshopify.com', '{ shop { name } }');
  await shopify.graphql('brand-b.myshopify.com', '{ shop { name } }');
  assert.equal(requests.filter((u) => u.endsWith('access_token')).length, 2);
  await assert.rejects(() => shopify.graphql('not-a-shop.com', '{ shop { name } }'), /valid shop/);
});
