// The page your customers (store owners) see when they open
// "Instagarment Print on Demand" inside their Shopify admin.
import { escapeHtml as e } from './html.js';
import { BRAND_STYLE } from './views.js';

export function embeddedPage({ clientId, appName, companyName, tracking }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="shopify-api-key" content="${e(clientId)}">
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <link rel="icon" href="/favicon.png">
  <title>${e(appName)}</title>
  <style>${BRAND_STYLE}
    .hero { display:flex; gap:16px; align-items:center; padding:16px }
    .hero img { width:72px; height:72px; flex:none }
    .hero h2 { margin:0 0 4px; font-size:20px }
    .status { color:var(--ok); font-weight:700 }
    .section-h { padding:12px 14px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap }
    .section-h h3 { margin:0; font-size:15px }
    .prod { display:flex; gap:12px; align-items:center; padding:8px 14px; border-bottom:1px solid var(--line) }
    .prod:last-child { border-bottom:0 }
    .prod img, .prod .ph { width:40px; height:40px; border-radius:6px; object-fit:cover; background:var(--line); flex:none }
    .prod .t { flex:1 }
    .badge { display:inline-block; border-radius:999px; padding:2px 10px; font-size:12px; font-weight:700 }
    .badge.to-print { background:var(--brand); color:#111 }
    .badge.printed { background:color-mix(in srgb, var(--ok) 20%, transparent); color:var(--ok) }
    ol { margin:0; padding:12px 14px 14px 34px; line-height:1.6 }
    code { background:var(--bg); border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:12px }
  </style></head>
  <body><main>
    <div class="card hero">
      <img src="/logo.png" alt="${e(companyName)}">
      <div>
        <h2>${e(appName)}</h2>
        <div class="status">● Connected to ${e(companyName)}</div>
        <div class="muted">When a customer orders one of the products below, ${e(companyName)} is notified straight away and starts printing.</div>
      </div>
    </div>

    <div class="card">
      <div class="section-h">
        <h3>Products ${e(companyName)} prints for you</h3>
        <button class="primary" id="add">Add products</button>
      </div>
      <div id="products"><div class="empty">Loading…</div></div>
    </div>

    <div class="card">
      <div class="section-h">
        <h3>Recent orders sent to ${e(companyName)}</h3>
        <button id="scan" title="Send any open orders from the last 30 days that weren't sent yet">Send past 30 days</button>
      </div>
      <div id="orders"><div class="empty">Loading…</div></div>
    </div>

    <div class="card">
      <div class="section-h"><h3>How it works</h3></div>
      <ol>
        <li>Choose which of your products ${e(companyName)} prints. They get the tag <code>${e(tracking.productTag)}</code>.</li>
        <li>When an order includes one of them, ${e(companyName)} gets an alert right away. Your other products aren't affected.</li>
        <li>The order is tagged <code>${e(tracking.toPrintTag)}</code>, then <code>${e(tracking.printedTag)}</code> once everything is printed, so you can filter your Orders page by status.</li>
      </ol>
    </div>
  </main>

  <script>
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    async function api(path, options = {}) {
      const token = await shopify.idToken();
      const res = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
      return res.json();
    }

    function renderProducts(products) {
      const el = document.getElementById('products');
      if (!products.length) {
        el.innerHTML = '<div class="empty">No products chosen yet. Click <b>Add products</b> to choose the ones ${e(companyName)} prints.</div>';
        return;
      }
      el.innerHTML = products.map((p) => \`
        <div class="prod">
          \${p.image ? \`<img src="\${esc(p.image)}" alt="">\` : '<div class="ph"></div>'}
          <div class="t">\${esc(p.title)} \${p.status !== 'ACTIVE' ? \`<span class="muted">(\${esc(p.status.toLowerCase())})</span>\` : ''}</div>
          <button data-remove="\${esc(p.id)}">Remove</button>
        </div>\`).join('');
    }

    function renderOrders(orders) {
      const el = document.getElementById('orders');
      if (!orders.length) {
        el.innerHTML = '<div class="empty">No orders sent yet.</div>';
        return;
      }
      el.innerHTML = '<table><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th></tr>' + orders.map((o) => \`
        <tr>
          <td><b>\${esc(o.name)}</b></td>
          <td class="muted">\${esc(new Date(o.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }))}</td>
          <td>\${o.items.map((i) => \`\${i.quantity} × \${esc(i.title)}\${i.variantTitle ? ' — ' + esc(i.variantTitle) : ''}\`).join('<br>')}</td>
          <td><span class="badge \${o.status}">\${o.status === 'printed' ? 'Printed' : 'In production'}</span></td>
        </tr>\`).join('') + '</table>';
    }

    async function load() {
      try {
        const data = await api('/api/overview');
        renderProducts(data.products);
        renderOrders(data.orders);
      } catch (err) {
        document.getElementById('products').innerHTML = '<div class="empty">Couldn\\'t load: ' + esc(err.message) + '</div>';
      }
    }

    document.getElementById('add').addEventListener('click', async () => {
      const selected = await shopify.resourcePicker({ type: 'product', multiple: true, filter: { variants: false } });
      if (!selected || !selected.length) return;
      await api('/api/products', { method: 'POST', body: JSON.stringify({ ids: selected.map((p) => p.id), tracked: true }) });
      shopify.toast.show(selected.length + ' product' + (selected.length === 1 ? '' : 's') + ' added');
      load();
    });

    document.getElementById('products').addEventListener('click', async (ev) => {
      const id = ev.target.closest('[data-remove]')?.dataset.remove;
      if (!id) return;
      ev.target.disabled = true;
      await api('/api/products', { method: 'POST', body: JSON.stringify({ ids: [id], tracked: false }) });
      shopify.toast.show('Product removed');
      load();
    });

    document.getElementById('scan').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await api('/api/scan', { method: 'POST', body: '{}' });
        shopify.toast.show(r.found ? r.found + ' order' + (r.found === 1 ? '' : 's') + ' sent to ${e(companyName)}' : 'No unsent orders found');
        load();
      } finally {
        ev.target.disabled = false;
      }
    });

    load();
  </script>
  </body></html>`;
}

export function privacyPage({ appName, companyName, contactEmail }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="/favicon.png">
  <title>Privacy policy · ${e(appName)}</title><style>${BRAND_STYLE} main{max-width:720px;line-height:1.6}</style></head>
  <body><div class="brandbar"><img src="/logo.png" alt=""><h1>${e(appName)}</h1></div>
  <main class="card" style="margin-top:16px;padding:8px 24px 24px">
    <h2>Privacy policy</h2>
    <p>${e(appName)} ("the app") is provided by ${e(companyName)} to Shopify merchants whose products ${e(companyName)} prints.</p>
    <h3>What the app accesses</h3>
    <p>When a store's order contains a product the merchant has chosen for ${e(companyName)} to print, the app reads that order's
    order number, line items (product, variant, quantity, SKU and personalisation text), order note, shipping method, and the
    shipping name and city, so ${e(companyName)} can produce the items.</p>
    <h3>What the app stores</h3>
    <p>The app doesn't keep a copy of orders or customer details. Print status is saved on the order inside the merchant's own Shopify
    store (as order tags and an order metafield). The app keeps only a list of stores that installed it (store name, address and
    install date). Order details are included in alert emails sent to ${e(companyName)}'s production team.</p>
    <h3>Sharing</h3>
    <p>Data is used only to fulfil print orders and isn't sold or shared with third parties, other than the email provider used to deliver alerts.</p>
    <h3>Removal</h3>
    <p>Uninstalling the app stops all access. Shopify then asks the app to delete the store's data, and the store is removed from the list.
    Customer data requests are answered through Shopify's standard process.</p>
    <h3>Contact</h3>
    <p>${contactEmail ? `Email <a href="mailto:${e(contactEmail)}">${e(contactEmail)}</a>.` : `Contact ${e(companyName)}.`}</p>
  </main></body></html>`;
}
