import crypto from 'node:crypto';

const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isShopDomain(shop) {
  return typeof shop === 'string' && SHOP_PATTERN.test(shop);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Signs a "client assertion": a short-lived note, signed with your private key,
 * that proves to Shopify this request really comes from your app. Shopify then
 * hands back an access token for that store. This works for every store that
 * has installed the app, any time, with nothing to store or refresh.
 */
export function createClientAssertion({ clientId, keyId, privateKey }, shop) {
  const key = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
  let alg;
  if (key.asymmetricKeyType === 'rsa') alg = 'RS256';
  else if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') alg = 'ES256';
  else throw new Error('SHOPIFY_PRIVATE_KEY must be an RSA or P-256 EC private key');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg, kid: keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: clientId,
      sub: clientId,
      aud: `https://${shop}/admin/oauth/access_token`,
      iat: now,
      exp: now + 60,
      jti: crypto.randomUUID(),
    }),
  );
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    ...(alg === 'ES256' ? { dsaEncoding: 'ieee-p1363' } : {}),
  });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

export function createShopify(settings, { fetchImpl = fetch } = {}) {
  const { clientId, apiVersion } = settings;
  const privateKey = crypto.createPrivateKey(settings.privateKey);
  const tokens = new Map(); // shop -> { token, renewAt }
  const pending = new Map();

  async function requestToken(shop) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: createClientAssertion({ ...settings, privateKey }, shop),
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(
            `Could not get access to ${shop} (HTTP ${res.status} ${body?.error || ''} ${body?.error_description || ''}). ` +
              'Is the app still installed there, and is the public key added in the Dev Dashboard?',
          );
          err.status = res.status;
          throw err;
        }
        const life = body.expires_in || 3599;
        return { token: body.access_token, renewAt: Date.now() + Math.max(life - 300, life / 2) * 1000 };
      } catch (err) {
        const retryable = !err.status || err.status >= 500;
        if (attempt >= 3 || !retryable) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }

  async function getToken(shop) {
    if (!isShopDomain(shop)) throw new Error(`Not a valid shop domain: ${shop}`);
    const cached = tokens.get(shop);
    if (cached && Date.now() < cached.renewAt) return cached.token;
    if (!pending.has(shop)) {
      pending.set(
        shop,
        requestToken(shop)
          .then((t) => (tokens.set(shop, t), t.token))
          .finally(() => pending.delete(shop)),
      );
    }
    return pending.get(shop);
  }

  async function graphql(shop, query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getToken(shop) },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401) tokens.delete(shop);
      if ((res.status === 401 || res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`Shopify API request to ${shop} failed (${res.status}): ${await res.text()}`);

      const { data, errors } = await res.json();
      if (errors?.some((e) => e.extensions?.code === 'THROTTLED') && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (errors?.length) throw new Error(`Shopify API error from ${shop}: ${JSON.stringify(errors)}`);
      return data;
    }
  }

  return { graphql, getToken };
}

// Shopify signs every webhook with your app's client secret. Reject anything
// whose signature doesn't match, so nobody can send fake orders.
export function verifyWebhook(rawBody, hmacHeader, clientSecret) {
  if (!hmacHeader || !rawBody) return false;
  const digest = crypto.createHmac('sha256', clientSecret).update(rawBody).digest();
  const given = Buffer.from(hmacHeader, 'base64');
  return given.length === digest.length && crypto.timingSafeEqual(digest, given);
}

/**
 * When a store owner opens the app inside Shopify admin, Shopify gives the page
 * an "ID token" proving who they are and which store they're in. We check it on
 * every request from that page. Returns the shop domain, or throws.
 */
export function verifyIdToken(token, { clientId, clientSecret }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, s] = parts;

  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  if (header.alg !== 'HS256') throw new Error('Unexpected token algorithm');

  const expected = crypto.createHmac('sha256', clientSecret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('Bad token signature');
  }

  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  const skew = 10;
  if (typeof claims.exp !== 'number' || claims.exp < now - skew) throw new Error('Token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + skew) throw new Error('Token not yet valid');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('Token is for a different app');

  const shop = new URL(claims.dest).hostname;
  if (new URL(claims.iss).hostname !== shop) throw new Error('Token issuer mismatch');
  if (!isShopDomain(shop)) throw new Error('Token has an invalid shop');
  return shop;
}
