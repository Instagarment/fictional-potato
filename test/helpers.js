// Shared test fixtures: a pretend Shopify that keeps orders in memory.

export const tracking = {
  productTag: 'instagarment',
  toPrintTag: 'instagarment-to-print',
  printedTag: 'instagarment-printed',
};

export const quietLog = { info() {}, error() {}, warn() {} };

export function lineItem(id, { tags = [], sku = '', qty = 1, title = 'Tee', attrs = [] } = {}) {
  return {
    id: `gid://shopify/LineItem/${id}`,
    title,
    variantTitle: 'Black / L',
    sku,
    quantity: qty,
    currentQuantity: qty,
    customAttributes: attrs,
    image: null,
    product: { id: `gid://shopify/Product/${id}`, tags },
  };
}

export function makeOrder(overrides = {}) {
  return {
    id: 'gid://shopify/Order/1001',
    legacyResourceId: '1001',
    name: '#1001',
    createdAt: '2026-11-01T12:00:00Z',
    cancelledAt: null,
    tags: [],
    note: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    customer: { displayName: 'Sam Rivera' },
    shippingAddress: { name: 'Sam Rivera', city: 'Austin', provinceCode: 'TX', countryCodeV2: 'US' },
    shippingLine: { title: 'Standard' },
    metafield: null,
    lineItems: {
      nodes: [
        lineItem(1, { tags: ['Instagarment'], title: 'Sunset Tee', attrs: [{ key: 'Name', value: 'ALEX' }] }),
        lineItem(2, { tags: ['in-stock'], title: 'Plain Hoodie' }),
      ],
    },
    ...overrides,
  };
}

export function fakeShops(map) {
  const data = Object.fromEntries(
    Object.entries(map).map(([shop, name]) => [shop, { name, installedAt: '2026-11-01T00:00:00Z', uninstalledAt: null }]),
  );
  return {
    get: (shop) => data[shop] || null,
    active: () => Object.entries(data).filter(([, s]) => !s.uninstalledAt).map(([shop, s]) => ({ shop, ...s })),
    all: () => Object.entries(data).map(([shop, s]) => ({ shop, ...s })),
    upsert(shop, { name } = {}) {
      data[shop] = { ...(data[shop] || { installedAt: new Date().toISOString() }), name: name || data[shop]?.name || shop, uninstalledAt: null };
    },
    markUninstalled(shop) {
      if (data[shop]) data[shop].uninstalledAt = new Date().toISOString();
    },
    remove(shop) {
      delete data[shop];
    },
  };
}

/** One order per shop, plus a product list, answering the queries the app makes. */
export function fakeStore(ordersByShop, { products = {}, shopNames = {} } = {}) {
  const calls = [];
  const store = {
    orders: ordersByShop,
    products,
    calls,
    async graphql(shop, query, v = {}) {
      calls.push({ shop, op: query.match(/(query|mutation) (\w+)/)?.[2] || 'anon' });
      const order = store.orders[shop];
      if (query.includes('{ shop { name } }')) return { shop: { name: shopNames[shop] || shop } };
      if (query.includes('query Order(')) return { order: order && order.id === v.id ? order : null };
      if (query.includes('tagsAdd')) {
        const target = v.id.includes('/Product/') ? (store.products[shop] ||= {})[v.id] ||= { tags: [] } : order;
        for (const t of v.tags) if (!target.tags.includes(t)) target.tags.push(t);
        return { tagsAdd: { userErrors: [] } };
      }
      if (query.includes('tagsRemove')) {
        const target = v.id.includes('/Product/') ? store.products[shop]?.[v.id] : order;
        if (target) target.tags = target.tags.filter((t) => !v.tags.includes(t));
        return { tagsRemove: { userErrors: [] } };
      }
      if (query.includes('metafieldsSet')) {
        order.metafield = { value: v.metafields[0].value };
        return { metafieldsSet: { userErrors: [] } };
      }
      if (query.includes('query Orders(')) {
        const want = [...v.query.matchAll(/(-?)tag:'([^']+)'/g)];
        const positives = want.filter((m) => !m[1]).map((m) => m[2]);
        const negatives = want.filter((m) => m[1]).map((m) => m[2]);
        const matches =
          order &&
          (positives.length === 0 || positives.some((t) => order.tags.includes(t))) &&
          !negatives.some((t) => order.tags.includes(t));
        return { orders: { nodes: matches ? [order] : [], pageInfo: { hasNextPage: false, endCursor: null } } };
      }
      if (query.includes('query Tracked(')) {
        const nodes = Object.entries(store.products[shop] || {})
          .filter(([, p]) => p.tags.includes('instagarment'))
          .map(([id, p]) => ({ id, title: p.title || id, status: 'ACTIVE', featuredMedia: null }));
        return { products: { nodes } };
      }
      throw new Error('unexpected query ' + query);
    },
  };
  return store;
}
