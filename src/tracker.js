// The core logic: decide which items in an order are print-on-demand, tag the
// order, keep track of what's been printed, and build the print queue.
//
// Nothing is stored on this server. Shopify itself holds the state:
//   - order tag "needs-printing" (configurable) = has POD items still to print
//   - order tag "printed"                       = every POD item has been printed
//   - order metafield pod_tracker.printed        = which line items are done
// So you can redeploy or move this app any time without losing anything, and you
// can filter orders by those tags in the Shopify admin.

const METAFIELD_NAMESPACE = 'pod_tracker';
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
  const tag = tracking.productTag?.trim().toLowerCase();
  const productTags = (item.product?.tags || []).map((t) => t.toLowerCase());
  if (tag && productTags.includes(tag)) return true;

  const sku = (item.sku || '').toUpperCase();
  return sku !== '' && tracking.skuPrefixes.some((p) => sku.startsWith(p.toUpperCase()));
}

export function parsePrinted(order) {
  try {
    const parsed = JSON.parse(order.metafield?.value || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

// Returns the print-on-demand items in an order, each with a `printed` flag.
export function trackedItems(order, tracking) {
  const printed = parsePrinted(order);
  return order.lineItems.nodes
    .filter((item) => item.currentQuantity > 0 && isTrackedItem(item, tracking))
    .map((item) => ({ ...item, printed: printed.has(numericId(item.id)) }));
}

export function adminOrderUrl(shopDomain, order) {
  const handle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}/orders/${order.legacyResourceId}`;
}

// ---- Things that talk to Shopify -------------------------------------------

export function createTracker({ shopify, tracking, mailer, log = console }) {
  const inFlight = new Set();

  async function fetchOrder(orderGid) {
    const data = await shopify.graphql(
      `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
      { id: orderGid },
    );
    return data.order;
  }

  async function addTags(id, tags) {
    const data = await shopify.graphql(
      `mutation AddTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id, tags },
    );
    throwOnUserErrors(data.tagsAdd);
  }

  async function removeTags(id, tags) {
    const data = await shopify.graphql(
      `mutation RemoveTags($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id, tags },
    );
    throwOnUserErrors(data.tagsRemove);
  }

  async function savePrinted(orderGid, printedIds) {
    const data = await shopify.graphql(
      `mutation SavePrinted($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      {
        metafields: [
          {
            ownerId: orderGid,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: 'json',
            value: JSON.stringify([...printedIds]),
          },
        ],
      },
    );
    throwOnUserErrors(data.metafieldsSet);
  }

  function hasTag(order, tag) {
    return order.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  }

  /**
   * Look at one order. If it contains print-on-demand items and hasn't been
   * seen before, tag it and (optionally) send the email alert.
   * Returns { status, items } where status is one of:
   *   'not-found' | 'cancelled' | 'no-pod-items' | 'already-tracked' | 'tracked'
   */
  async function processOrder(orderGid, { notify = true } = {}) {
    if (inFlight.has(orderGid)) return { status: 'already-tracked', items: [] };
    inFlight.add(orderGid);
    try {
      const order = await fetchOrder(orderGid);
      if (!order) return { status: 'not-found', items: [] };
      if (order.cancelledAt) return { status: 'cancelled', items: [] };

      const items = trackedItems(order, tracking);
      if (items.length === 0) return { status: 'no-pod-items', items };

      // Shopify can deliver the same webhook more than once — the tag tells us
      // we've already handled this order, so you don't get duplicate emails.
      if (hasTag(order, tracking.toPrintTag) || hasTag(order, tracking.printedTag)) {
        return { status: 'already-tracked', items };
      }

      await addTags(order.id, [tracking.toPrintTag]);
      log.info(`${order.name}: ${items.length} print-on-demand item(s) — tagged "${tracking.toPrintTag}"`);

      if (notify && mailer) {
        try {
          await mailer.sendPrintAlert(order, items);
          log.info(`${order.name}: alert email sent`);
        } catch (err) {
          log.error(`${order.name}: could not send alert email — ${err.message}`);
        }
      }
      return { status: 'tracked', items };
    } finally {
      // Keep it briefly so near-simultaneous duplicate webhooks are ignored.
      setTimeout(() => inFlight.delete(orderGid), 60_000).unref?.();
    }
  }

  /** Mark line items printed (or not printed) and update the order's tags. */
  async function setPrinted(orderGid, lineItemIds, isPrinted) {
    const order = await fetchOrder(orderGid);
    if (!order) throw new Error('Order not found');

    const printed = parsePrinted(order);
    for (const id of lineItemIds.map(numericId)) {
      if (isPrinted) printed.add(id);
      else printed.delete(id);
    }
    await savePrinted(order.id, printed);

    const items = trackedItems(order, tracking);
    const allDone = items.length > 0 && items.every((i) => printed.has(numericId(i.id)));

    if (allDone) {
      await addTags(order.id, [tracking.printedTag]);
      if (hasTag(order, tracking.toPrintTag)) await removeTags(order.id, [tracking.toPrintTag]);
    } else {
      await addTags(order.id, [tracking.toPrintTag]);
      if (hasTag(order, tracking.printedTag)) await removeTags(order.id, [tracking.printedTag]);
    }
    return { allDone };
  }

  async function searchOrders(query, { max = 250, newestFirst = false } = {}) {
    const orders = [];
    let after = null;
    while (orders.length < max) {
      const data = await shopify.graphql(
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
    return orders;
  }

  /** Everything still waiting to be printed, oldest order first. */
  async function getQueue() {
    const orders = await searchOrders(`tag:'${tracking.toPrintTag}' AND -status:cancelled`);
    return orders
      .map((order) => ({ order, items: trackedItems(order, tracking) }))
      .filter((entry) => entry.items.length > 0);
  }

  /** Recently finished orders, newest first, for the "Printed" tab. */
  async function getRecentlyPrinted(limit = 25) {
    const orders = await searchOrders(`tag:'${tracking.printedTag}'`, { max: limit, newestFirst: true });
    return orders
      .slice(0, limit)
      .map((order) => ({ order, items: trackedItems(order, tracking) }));
  }

  /**
   * Check older orders (e.g. ones placed before you installed this app).
   * Only untagged, open orders from the last `days` days are looked at.
   */
  async function scanRecentOrders({ days = 30, notify = false } = {}) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const orders = await searchOrders(
      `created_at:>=${since} AND status:open AND -tag:'${tracking.toPrintTag}' AND -tag:'${tracking.printedTag}'`,
      { max: 1000 },
    );
    let found = 0;
    for (const order of orders) {
      const result = await processOrder(order.id, { notify });
      if (result.status === 'tracked') found++;
    }
    return { checked: orders.length, found };
  }

  return { processOrder, setPrinted, getQueue, getRecentlyPrinted, scanRecentOrders, fetchOrder };
}

function throwOnUserErrors(result) {
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e) => e.message).join('; '));
  }
}
