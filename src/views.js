// Instagarment's own admin pages: the combined print queue across every store.
import { escapeHtml as e } from './html.js';
import { numericId } from './tracker.js';

export const BRAND_STYLE = `
  :root { --bg:#f6f6f7; --card:#fff; --text:#1a1a1a; --muted:#6b6b6b; --line:#e3e3e3; --brand:#FDB913; --ink:#111; --ok:#1a7f37; --note:#fff4d6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121212; --card:#1e1e1e; --text:#eee; --muted:#a0a0a0; --line:#333; --ok:#4ac26b; --note:#3a3110; }
  }
  * { box-sizing:border-box }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; background:var(--bg); color:var(--text); }
  .brandbar { background:var(--ink); color:var(--brand); padding:10px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap }
  .brandbar img { width:40px; height:40px }
  .brandbar h1 { font-size:17px; margin:0; flex:1; font-weight:800; letter-spacing:.2px }
  .brandbar nav a { color:#cfcfcf; text-decoration:none; margin-right:14px; font-weight:600 }
  .brandbar nav a.on { color:var(--brand); border-bottom:2px solid var(--brand) }
  main { max-width:980px; margin:0 auto; padding:16px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:14px; overflow-x:auto }
  .card-h { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--line); flex-wrap:wrap }
  .store { display:inline-block; background:var(--brand); color:#111; font-weight:700; font-size:12px; border-radius:999px; padding:2px 10px; margin-right:6px }
  .muted { color:var(--muted); font-size:13px }
  .item { display:flex; gap:12px; padding:10px 14px; border-bottom:1px solid var(--line); align-items:center }
  .item:last-child { border-bottom:0 }
  .item img, .ph { width:56px; height:56px; border-radius:6px; object-fit:cover; background:var(--line); flex:none }
  .item .info { flex:1; min-width:0 }
  .item .t { font-weight:600 }
  .qty { font-size:22px; font-weight:800; min-width:48px; text-align:center }
  .done { opacity:.5 } .done .t { text-decoration:line-through }
  .prop { font-size:13px }
  button { font:inherit; font-weight:600; border-radius:6px; padding:7px 12px; cursor:pointer; border:1px solid var(--line); background:var(--card); color:var(--text) }
  button.primary { background:var(--brand); color:#111; border-color:var(--brand) }
  form { margin:0 }
  table { width:100%; border-collapse:collapse } td, th { padding:10px 14px; border-bottom:1px solid var(--line); text-align:left }
  th { font-size:12px; text-transform:uppercase; color:var(--muted) }
  .flash { padding:10px 14px; border-radius:8px; margin-bottom:14px; background:var(--card); border:1px solid var(--line) }
  .flash.err { border-color:#d93f3f }
  .empty { text-align:center; padding:48px 16px; color:var(--muted) }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
  .note { padding:8px 14px; font-size:13px; background:var(--note) }
`;

function layout({ title, tab, body, flash, errors = [] }) {
  const tabs = [
    ['queue', '/admin', 'To print'],
    ['picklist', '/admin/picklist', 'Pick list'],
    ['printed', '/admin/printed', 'Printed'],
    ['stores', '/admin/stores', 'Stores'],
    ['setup', '/admin/setup', 'Setup'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="/favicon.png">
  <title>${e(title)} · Instagarment</title><style>${BRAND_STYLE}</style></head>
  <body><div class="brandbar"><img src="/logo.png" alt=""><h1>Instagarment Print Queue</h1>
  <nav>${tabs.map(([k, href, label]) => `<a href="${href}" class="${tab === k ? 'on' : ''}">${label}</a>`).join('')}</nav></div>
  <main>
  ${flash ? `<div class="flash">${e(flash)}</div>` : ''}
  ${errors.map((x) => `<div class="flash err">Couldn't reach <b>${e(x.shopName)}</b>: ${e(x.error)}</div>`).join('')}
  ${body}</main></body></html>`;
}

function itemRow(entry, item, { actions = true } = {}) {
  const props = item.customAttributes
    .filter((a) => a.value && !a.key.startsWith('_'))
    .map((a) => `<div class="prop">${e(a.key)}: <b>${e(a.value)}</b></div>`)
    .join('');
  const img = item.image?.url ? `<img src="${e(item.image.url)}" alt="">` : '<div class="ph"></div>';
  const button = actions
    ? `<form method="post" action="/admin/orders/${e(entry.shop)}/${numericId(entry.order.id)}/items">
         <input type="hidden" name="lineItemId" value="${numericId(item.id)}">
         <input type="hidden" name="printed" value="${item.printed ? 'false' : 'true'}">
         <button>${item.printed ? 'Undo' : 'Printed ✓'}</button>
       </form>`
    : '';
  return `<div class="item ${item.printed ? 'done' : ''}">
    ${img}
    <div class="info">
      <div class="t">${e(item.title)}</div>
      ${item.variantTitle ? `<div>${e(item.variantTitle)}</div>` : ''}
      ${item.sku ? `<div class="muted">SKU ${e(item.sku)}</div>` : ''}
      ${props}
    </div>
    <div class="qty">×${item.currentQuantity}</div>
    ${button}
  </div>`;
}

function orderCard(entry, { actions = true } = {}) {
  const { order, items } = entry;
  const who = order.shippingAddress?.name || order.customer?.displayName || '';
  const date = new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const remaining = items.filter((i) => !i.printed);
  return `<div class="card">
    <div class="card-h">
      <div>
        <span class="store">${e(entry.shopName)}</span><b>${e(order.name)}</b>
        <span class="muted"> · ${e(date)}${who ? ` · ${e(who)}` : ''}${order.shippingLine?.title ? ` · ${e(order.shippingLine.title)}` : ''}</span>
      </div>
      ${
        actions && remaining.length
          ? `<form method="post" action="/admin/orders/${e(entry.shop)}/${numericId(order.id)}/items">
               ${remaining.map((i) => `<input type="hidden" name="lineItemId" value="${numericId(i.id)}">`).join('')}
               <input type="hidden" name="printed" value="true">
               <button class="primary">Mark all printed</button>
             </form>`
          : `<span class="muted">${e((order.displayFulfillmentStatus || '').toLowerCase().replace(/_/g, ' '))}</span>`
      }
    </div>
    ${order.note ? `<div class="note"><b>Note:</b> ${e(order.note)}</div>` : ''}
    ${items.map((i) => itemRow(entry, i, { actions })).join('')}
  </div>`;
}

export function queuePage({ queue, errors, flash }) {
  const pieces = queue.reduce((n, q) => n + q.items.filter((i) => !i.printed).reduce((m, i) => m + i.currentQuantity, 0), 0);
  const stores = new Set(queue.map((q) => q.shop)).size;
  const body = `
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div><b>${pieces}</b> piece${pieces === 1 ? '' : 's'} to print · <b>${queue.length}</b> order${queue.length === 1 ? '' : 's'} · <b>${stores}</b> store${stores === 1 ? '' : 's'}</div>
      <form method="post" action="/admin/scan" class="row">
        <span class="muted">Check all stores' orders from the last</span>
        <select name="days" style="font:inherit;padding:6px"><option>7</option><option selected>30</option><option>60</option></select>
        <span class="muted">days</span>
        <button>Scan</button>
      </form>
    </div>
    ${queue.length ? queue.map((q) => orderCard(q)).join('') : `<div class="card empty">Nothing to print right now. 🎉<br><br>New orders from your customers' stores will show up here automatically.</div>`}`;
  return layout({ title: 'To print', tab: 'queue', body, flash, errors });
}

// Totals across all open orders, for printing in batches.
export function picklistPage({ queue, errors }) {
  const totals = new Map();
  for (const entry of queue) {
    for (const item of entry.items.filter((i) => !i.printed)) {
      const key = `${entry.shop}|${item.title}|${item.variantTitle || ''}|${item.sku || ''}`;
      const row = totals.get(key) || { entry, item, qty: 0, orders: new Set(), custom: false };
      row.qty += item.currentQuantity;
      row.orders.add(entry.order.name);
      row.custom ||= item.customAttributes.some((a) => a.value && !a.key.startsWith('_'));
      totals.set(key, row);
    }
  }
  const rows = [...totals.values()].sort(
    (a, b) => a.entry.shopName.localeCompare(b.entry.shopName) || a.item.title.localeCompare(b.item.title) || b.qty - a.qty,
  );
  const body = rows.length
    ? `<div class="card"><table>
        <tr><th>Store</th><th>Design</th><th>Variant</th><th>SKU</th><th>Qty</th><th>Orders</th></tr>
        ${rows
          .map(
            (r) => `<tr>
              <td><span class="store">${e(r.entry.shopName)}</span></td>
              <td><b>${e(r.item.title)}</b>${r.custom ? ' <span class="muted">(personalised — see order)</span>' : ''}</td>
              <td>${e(r.item.variantTitle || '—')}</td>
              <td class="muted">${e(r.item.sku || '')}</td>
              <td style="font-size:20px;font-weight:800">${r.qty}</td>
              <td class="muted">${e([...r.orders].join(', '))}</td>
            </tr>`,
          )
          .join('')}
      </table></div>`
    : `<div class="card empty">Nothing to print right now.</div>`;
  return layout({ title: 'Pick list', tab: 'picklist', body, errors });
}

export function printedPage({ printed }) {
  const body = printed.length
    ? printed.map((q) => orderCard(q, { actions: false })).join('')
    : `<div class="card empty">No printed orders yet.</div>`;
  return layout({ title: 'Printed', tab: 'printed', body });
}

export function storesPage({ shops }) {
  const body = shops.length
    ? `<div class="card"><table>
        <tr><th>Store</th><th>Shopify address</th><th>Installed</th><th>Status</th></tr>
        ${shops
          .map(
            (s) => `<tr>
              <td><b>${e(s.name)}</b></td>
              <td class="muted">${e(s.shop)}</td>
              <td class="muted">${e(new Date(s.installedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }))}</td>
              <td>${s.uninstalledAt ? '<span class="muted">Uninstalled</span>' : '<span style="color:var(--ok);font-weight:700">Connected</span>'}</td>
            </tr>`,
          )
          .join('')}
      </table></div>`
    : `<div class="card empty">No stores have installed the app yet.<br><br>Send your customers your install link (see the README).</div>`;
  return layout({ title: 'Stores', tab: 'stores', body });
}

export function setupPage({ appUrl, jwk, toml, emailReady, storeCount, flash }) {
  const check = (ok, label, help) =>
    `<tr><td style="width:36px;font-size:20px">${ok ? '✅' : '⬜️'}</td><td><b>${label}</b>${help ? `<div class="muted">${help}</div>` : ''}</td></tr>`;
  const body = `
    <div class="card"><div class="card-h"><b>Checklist</b></div><table>
      ${check(appUrl.startsWith('https://'), 'APP_URL is set', appUrl ? e(appUrl) : 'Set APP_URL in Render to this site’s https:// address, then redeploy.')}
      ${check(emailReady, 'Email alerts are set up', emailReady ? '' : 'Set SMTP_HOST, SMTP_USER, SMTP_PASS and ALERT_EMAIL_TO in Render.')}
      ${check(storeCount > 0, 'At least one store has installed the app', `${storeCount} connected store${storeCount === 1 ? '' : 's'}`)}
    </table>
    ${emailReady ? `<form method="post" action="/admin/setup/test-email" style="padding:0 14px 14px"><button>Send a test email</button></form>` : ''}
    </div>

    <div class="card"><div class="card-h"><b>Public key for the Shopify Dev Dashboard</b></div>
      <div style="padding:14px">
        <p class="muted" style="margin-top:0">In the Dev Dashboard, open your app → <b>Settings</b> → <b>Credentials</b> → <b>Public keys</b> → <b>Add key</b>, and paste all of this.
        It's the <i>public</i> half only and safe to copy. The private half never leaves this server.</p>
        <textarea readonly rows="10" style="width:100%;font:12px ui-monospace,monospace;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text)" onclick="this.select()">${e(JSON.stringify(jwk, null, 2))}</textarea>
      </div>
    </div>

    <div class="card"><div class="card-h"><b>Shopify app settings (shopify.app.toml)</b></div>
      <div style="padding:14px">
        <p class="muted" style="margin-top:0">In Render's <b>Shell</b> tab run <code>npm run shopify-config</code> then <code>npx @shopify/cli@latest app deploy</code>. This is what gets uploaded:</p>
        <pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;margin:0">${e(toml)}</pre>
      </div>
    </div>`;
  return layout({ title: 'Setup', tab: 'setup', body, flash });
}

export function messagePage(title, message) {
  return layout({ title, tab: '', body: `<div class="card empty">${e(message)}</div>` });
}
