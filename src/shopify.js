import crypto from 'node:crypto';

// Talks to the Shopify Admin GraphQL API using the "client credentials" grant,
// which is how an app made in the Shopify Dev Dashboard for your own store gets
// an access token. Tokens last 24 hours; we refresh a bit early.
export function createShopifyClient({ shopDomain, clientId, clientSecret, apiVersion }) {
  let token = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return token;

    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Shopify token request failed (${res.status}). Check SHOPIFY_SHOP_DOMAIN, ` +
          `SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET and that the app is installed on the store. ${body}`,
      );
    }
    const data = await res.json();
    token = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 86399) * 1000;
    return token;
  }

  async function graphql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': await getToken(),
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 401) token = null; // force a fresh token next time
      if ((res.status === 429 || res.status >= 500 || res.status === 401) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Shopify API request failed (${res.status}): ${await res.text()}`);
      }

      const { data, errors } = await res.json();
      const throttled = errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (errors?.length) throw new Error(`Shopify API error: ${JSON.stringify(errors)}`);
      return data;
    }
  }

  return { graphql, shopDomain };
}

// Shopify signs every webhook with your app's client secret. Reject anything
// whose signature doesn't match so nobody can fake orders.
export function verifyWebhook(rawBody, hmacHeader, clientSecret) {
  if (!hmacHeader || !rawBody) return false;
  const digest = crypto.createHmac('sha256', clientSecret).update(rawBody).digest();
  const given = Buffer.from(hmacHeader, 'base64');
  return given.length === digest.length && crypto.timingSafeEqual(digest, given);
}
