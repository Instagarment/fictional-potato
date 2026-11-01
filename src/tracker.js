// The core logic: decide which items in an order are Instagarment's to print,
// tag the order, keep track of what's been printed, and build the print queue
// across every customer store.
//
// Order state lives in each customer's Shopify store, not on this server:
//   - order tag "instagarment-to-print" = has items still to print
//   - order tag "instagarment-printed"  = every item has been printed
//   - order metafield instagarment.printed = which line items are done
// So the store owner can see the status on their own Orders page too.

const METAFIELD_NAMESPACE = 'instagarment';
const METAFIELD_KEY = 'printed';

const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  createdAt
  cancelledAt
  tags
  note
  displayFulfillmentStatus
  customer { displayName }
  shippingAddress { name city provinceCode countryCodeV2 }
  shippingLine { title }
  metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") { value }
  lineItems(first: 100) {
    nodes {
      id
      title
      variantTitle
      sku
      quantity
      currentQuantity
      customAttributes { key value }
      image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
      product { id tags }
    }
  }
`;

// ---- Pure helpers (easy to test) -------------------------------------------

export function numericId(gid) {
  return String(gid).split('/').pop();
}

export function isTrackedItem(item, tracking) {
  const tag = tracking.productTag.trim().toLowerCase();
  return (item.product?.tags || []).some((t) => t.toLowerCase() === tag);
}

export function parsePrinted(order) {
  try {
    const parsed = JSON.parse(order.metafield?.value || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

/** The items in an order that Instagarment prints, each with a `printed` flag. */
export function trackedItems(order, tracking) {
  const printed = parsePrinted(order);
  return order.lineItems.nodes
    .filter((item) => item.currentQuantity > 0 && isTrackedItem(item, tracking))
    .map((item) => ({ ...item, printed: printed.has(numericId(item.id)) }));
}

export function adminOrderUrl(shop, order) {
  const handle = shop.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}/orders/${order.legacyResourceId}`;
}

function hasTag(order, tag) {
  return order.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

function throwOnUserErrors(result) {
  if (result?.userErrors?.length) throw new Error(result.userErrors.map((e) => e.message).join('; '));
}

// ---- Things that talk to Shopify -------------------------------------------

export function createTracker({ graphql, shops, tracking, mailer, log = console }) {
  const inFlight = new Set();

  async function fetchOrder(shop, orderGid) {
    const data = await graphql(shop, `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: orderGid });
    return data.order;
  }

  async function addTags(shop, id, tags) {
    const data = await graphql(
      shop,
      `mutation AddTags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
      { id, tags },
    );
    throwOnUserErrors(data.tagsAdd);
  }

  async function removeTags(shop, id, tags) {
    const data = await graphql(
      shop,
      `mutation RemoveTags($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`,
      { id, tags },
    );
    throwOnUserErrors(data.tagsRemove);
  }

  async function savePrinted(shop, orderGid, printedIds) {
    const data = await graphql(
      shop,
      `mutation SavePrinted($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      {
        metafields: [
          { ownerId: orderGid, namespace: METAFIELD_NAMESPACE, key: METAFIELD_KEY, type: 'json', value: JSON.stringify([...printedIds]) },
        ],
      },
    );
    throwOnUserErrors(data.metafieldsSet);
  }

  /**
   * Look at one order. If it has Instagarment items and hasn't been seen
   * before, tag it and (optionally) email the alert.
   * status: 'not-found' | 'cancelled' | 'no-items' | 'already-tracked' | 'tracked'
   */
  async function processOrder(shop, orderGid, { notify = true } = {}) {
    const key = `${shop}|${orderGid}`;
    if (inFlight.has(key)) return { status: 'already-tracked', items: [] };
    inFlight.add(key);
    try {
      const order = await fetchOrder(shop, orderGid);
      if (!order) return { status: 'not-found', items: [] };
      if (order.cancelledAt) return { status: 'cancelled', items: [] };

      const items = trackedItems(order, tracking);
      if (items.length === 0) return { status: 'no-items', items };

      // Shopify can deliver the same webhook twice — the tag means we've
      // already handled this order, so no duplicate emails.
      if (hasTag(order, tracking.toPrintTag) || hasTag(order, tracking.printedTag)) {
        return { status: 'already-tracked', items };
      }

      await addTags(shop, order.id, [tracking.toPrintTag]);
      const shopName = shops.get(shop)?.name || shop;
      log.info(`${shopName} ${order.name}: ${items.length} item(s) to print`);

      if (notify && mailer) {
        try {
          await mailer.sendPrintAlert({ shop, shopName, order, items });
        } catch (err) {
          log.error(`${shopName} ${order.name}: could not send alert email — ${err.message}`);
        }
      }
      return { status: 'tracked', items };
    } finally {
      setTimeout(() => inFlight.delete(key), 60_000).unref?.();
    }
  }

  /** Mark line items printed (or not printed) and update the order's tags. */
  async function setPrinted(shop, orderGid, lineItemIds, isPrinted) {
    const order = await fetchOrder(shop, orderGid);
    if (!order) throw new Error('Order not found');

    const printed = parsePrinted(order);
    for (const id of lineItemIds.map(numericId)) {
      if (isPrinted) printed.add(id);
      else printed.delete(id);
    }
    await savePrinted(shop, order.id, printed);

    const items = trackedItems(order, tracking);
    const allDone = items.length > 0 && items.every((i) => printed.has(numericId(i.id)));
    const [add, remove] = allDone ? [tracking.printedTag, tracking.toPrintTag] : [tracking.toPrintTag, tracking.printedTag];
    await addTags(shop, order.id, [add]);
    if (hasTag(order, remove)) await removeTags(shop, order.id, [remove]);
    return { allDone };
  }

  async function searchOrders(shop, query, { max = 250, newestFirst = false } = {}) {
    const orders = [];
    let after = null;
    while (orders.length < max) {
      const data = await graphql(
        shop,
        `query Orders($query: String!, $after: String, $reverse: Boolean) {
          orders(first: 25, after: $after, query: $query, sortKey: CREATED_AT, reverse: $reverse) {
            nodes { ${ORDER_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { query, after, reverse: newestFirst },
      );
      orders.push(...data.orders.nodes);
      if (!data.orders.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }
    return orders.slice(0, max);
  }

  // Runs `fn` for each active store; one store failing doesn't break the rest.
  async function eachShop(fn) {
    const results = await Promise.all(
      shops.active().map(async (s) => {
        try {
          return { shop: s, value: await fn(s), error: null };
        } catch (err) {
          log.error(`${s.name}: ${err.message}`);
          return { shop: s, value: null, error: err.message };
        }
      }),
    );
    return results;
  }

  function withItems(shopInfo, orders) {
    return orders
      .map((order) => ({ shop: shopInfo.shop, shopName: shopInfo.name, order, items: trackedItems(order, tracking) }))
      .filter((e) => e.items.length > 0);
  }

  /** Everything waiting to be printed in every store, oldest first. */
  async function getQueue() {
    const results = await eachShop((s) => searchOrders(s.shop, `tag:'${tracking.toPrintTag}' AND -status:cancelled`));
    const queue = results
      .flatMap((r) => (r.value ? withItems(r.shop, r.value) : []))
      .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
    const errors = results.filter((r) => r.error).map((r) => ({ shopName: r.shop.name, error: r.error }));
    return { queue, errors };
  }

  /** Recently finished orders across all stores, newest first. */
  async function getRecentlyPrinted(limit = 30) {
    const results = await eachShop((s) => searchOrders(s.shop, `tag:'${tracking.printedTag}'`, { max: limit, newestFirst: true }));
    return results
      .flatMap((r) => (r.value ? withItems(r.shop, r.value) : []))
      .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt))
      .slice(0, limit);
  }

  /** Recent Instagarment orders in one store — shown to the store owner. */
  async function getShopOrders(shop, limit = 20) {
    const orders = await searchOrders(
      shop,
      `tag:'${tracking.toPrintTag}' OR tag:'${tracking.printedTag}'`,
      { max: limit, newestFirst: true },
    );
    return orders.map((order) => ({
      name: order.name,
      createdAt: order.createdAt,
      status: hasTag(order, tracking.printedTag) ? 'printed' : 'to-print',
      items: trackedItems(order, tracking).map((i) => ({
        title: i.title,
        variantTitle: i.variantTitle,
        quantity: i.currentQuantity,
        printed: i.printed,
      })),
    }));
  }

  /** Check recent untagged open orders in every store (or one store). */
  async function scanRecentOrders({ days = 30, notify = false, shop = null } = {}) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const query = `created_at:>=${since} AND status:open AND -tag:'${tracking.toPrintTag}' AND -tag:'${tracking.printedTag}'`;
    let checked = 0;
    let found = 0;
    const targets = shop ? shops.active().filter((s) => s.shop === shop) : shops.active();
    for (const s of targets) {
      try {
        const orders = await searchOrders(s.shop, query, { max: 1000 });
        checked += orders.length;
        for (const order of orders) {
          if (trackedItems(order, tracking).length === 0) continue;
          const result = await processOrder(s.shop, order.id, { notify });
          if (result.status === 'tracked') found++;
        }
      } catch (err) {
        log.error(`Scan of ${s.name} failed: ${err.message}`);
      }
    }
    return { checked, found };
  }

  // ---- Product selection (used by the store owner's page) -------------------

  async function getTrackedProducts(shop) {
    const data = await graphql(
      shop,
      `query Tracked($q: String!) {
        products(first: 250, query: $q, sortKey: TITLE) {
          nodes { id title status featuredMedia { preview { image { url(transform: { maxWidth: 120, maxHeight: 120 }) } } } }
        }
      }`,
      { q: `tag:'${tracking.productTag}'` },
    );
    return data.products.nodes.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      image: p.featuredMedia?.preview?.image?.url || null,
    }));
  }

  async function setProductsTracked(shop, productIds, isTracked) {
    for (const id of productIds) {
      if (isTracked) await addTags(shop, id, [tracking.productTag]);
      else await removeTags(shop, id, [tracking.productTag]);
    }
  }

  async function getShopName(shop) {
    const data = await graphql(shop, `{ shop { name } }`);
    return data.shop.name;
  }

  return {
    processOrder,
    setPrinted,
    getQueue,
    getRecentlyPrinted,
    getShopOrders,
    scanRecentOrders,
    getTrackedProducts,
    setProductsTracked,
    getShopName,
  };
}
