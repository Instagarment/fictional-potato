import { escapeHtml as e } from './html.js';
import { adminOrderUrl, numericId } from './tracker.js';

const STYLE = `
  :root { --bg:#f6f6f7; --card:#fff; --text:#1a1a1a; --muted:#6b6b6b; --line:#e3e3e3; --accent:#111; --ok:#1a7f37; --warn:#b54708; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --card:#1f1f1f; --text:#eee; --muted:#a0a0a0; --line:#333; --accent:#f2f2f2; --ok:#4ac26b; --warn:#f0a050; }
  }
  * { box-sizing:border-box }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:16px; border-bottom:1px solid var(--line); background:var(--card); display:flex; gap:16px; align-items:center; flex-wrap:wrap }
  header h1 { font-size:18px; margin:0; flex:1 }
  nav a { color:var(--muted); text-decoration:none; margin-right:14px; font-weight:600 }
  nav a.on { color:var(--text); border-bottom:2px solid var(--accent) }
  main { max-width:960px; margin:0 auto; padding:16px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:14px; overflow-x:auto }
  .card-h { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--line); flex-wrap:wrap }
  .card-h a { color:var(--text); font-weight:700; text-decoration:none }
  .muted { color:var(--muted); font-size:13px }
  .item { display:flex; gap:12px; padding:10px 14px; border-bottom:1px solid var(--line); align-items:center }
  .item:last-child { border-bottom:0 }
  .item img, .ph { width:56px; height:56px; border-radius:6px; object-fit:cover; background:var(--line); flex:none }
  .item .info { flex:1; min-width:0 }
  .item .t { font-weight:600 }
  .qty { font-size:22px; font-weight:800; min-width:48px; text-align:center }
  .done { opacity:.5 } .done .t { text-decoration:line-through }
  .prop { font-size:13px } .prop b { font-weight:700 }
  button { font:inherit; font-weight:600; border-radius:6px; padding:7px 12px; cursor:pointer; border:1px solid var(--line); background:var(--card); color:var(--text) }
  button.primary { background:var(--accent); color:var(--bg); border-color:var(--accent) }
  form { margin:0 }
  table { width:100%; border-collapse:collapse } td, th { padding:10px 14px; border-bottom:1px solid var(--line); text-align:left }
  th { font-size:12px; text-transform:uppercase; color:var(--muted) }
  .flash { padding:10px 14px; border-radius:8px; margin-bottom:14px; background:var(--card); border:1px solid var(--line) }
  .empty { text-align:center; padding:48px 16px; color:var(--muted) }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
  .note { padding:8px 14px; font-size:13px; background:color-mix(in srgb, var(--warn) 12%, transparent) }
`;

function layout({ title, tab, body, flash }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${e(title)} · Print Tracker</title><style>${STYLE}</style></head>
  <body><header><h1>🖨️ Print Tracker</h1>
  <nav>
    <a href="/" class="${tab === 'queue' ? 'on' : ''}">To print</a>
    <a href="/picklist" class="${tab === 'picklist' ? 'on' : ''}">Pick list</a>
    <a href="/printed" class="${tab === 'printed' ? 'on' : ''}">Printed</a>
  </nav></header>
  <main>${flash ? `<div class="flash">${e(flash)}</div>` : ''}${body}</main></body></html>`;
}

function itemRow(order, item, { actions = true } = {}) {
  const props = item.customAttributes
    .filter((a) => a.value && !a.key.startsWith('_'))
    .map((a) => `<div class="prop">${e(a.key)}: <b>${e(a.value)}</b></div>`)
    .join('');
  const img = item.image?.url ? `<img src="${e(item.image.url)}" alt="">` : '<div class="ph"></div>';
  const button = actions
    ? `<form method="post" action="/orders/${numericId(order.id)}/items">
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

function orderCard(shopDomain, { order, items }, { actions = true } = {}) {
  const who = order.shippingAddress?.name || order.customer?.displayName || '';
  const date = new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const remaining = items.filter((i) => !i.printed).length;
  return `<div class="card">
    <div class="card-h">
      <div>
        <a href="${e(adminOrderUrl(shopDomain, order))}" target="_blank" rel="noopener">${e(order.name)}</a>
        <span class="muted"> · ${e(date)}${who ? ` · ${e(who)}` : ''}${order.shippingLine?.title ? ` · ${e(order.shippingLine.title)}` : ''}</span>
      </div>
      ${
        actions && remaining > 0
          ? `<form method="post" action="/orders/${numericId(order.id)}/items">
               ${items.filter((i) => !i.printed).map((i) => `<input type="hidden" name="lineItemId" value="${numericId(i.id)}">`).join('')}
               <input type="hidden" name="printed" value="true">
               <button class="primary">Mark all printed</button>
             </form>`
          : `<span class="muted">${e(order.displayFulfillmentStatus?.toLowerCase().replace(/_/g, ' ') || '')}</span>`
      }
    </div>
    ${order.note ? `<div class="note"><b>Note:</b> ${e(order.note)}</div>` : ''}
    ${items.map((i) => itemRow(order, i, { actions })).join('')}
  </div>`;
}

export function queuePage({ shopDomain, queue, flash }) {
  const pieces = queue.reduce((n, q) => n + q.items.filter((i) => !i.printed).reduce((m, i) => m + i.currentQuantity, 0), 0);
  const body = `
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div><b>${queue.length}</b> order${queue.length === 1 ? '' : 's'} · <b>${pieces}</b> piece${pieces === 1 ? '' : 's'} to print</div>
      <form method="post" action="/scan" class="row">
        <span class="muted">Check orders from the last</span>
        <select name="days" style="font:inherit;padding:6px"><option>7</option><option selected>30</option><option>60</option></select>
        <span class="muted">days</span>
        <button>Scan</button>
      </form>
    </div>
    ${
      queue.length
        ? queue.map((q) => orderCard(shopDomain, q)).join('')
        : `<div class="card empty">Nothing to print right now. 🎉<br><br>New orders with print-on-demand items will show up here automatically.</div>`
    }`;
  return layout({ title: 'To print', tab: 'queue', body, flash });
}

// Totals across all open orders: "Classic Tee / Black / L ×4". Handy for printing in batches.
export function picklistPage({ queue }) {
  const totals = new Map();
  for (const { order, items } of queue) {
    for (const item of items.filter((i) => !i.printed)) {
      const hasCustom = item.customAttributes.some((a) => a.value && !a.key.startsWith('_'));
      const key = `${item.title}|${item.variantTitle || ''}|${item.sku || ''}`;
      const row = totals.get(key) || { item, qty: 0, orders: new Set(), custom: false };
      row.qty += item.currentQuantity;
      row.orders.add(order.name);
      row.custom ||= hasCustom;
      totals.set(key, row);
    }
  }
  const rows = [...totals.values()].sort((a, b) => a.item.title.localeCompare(b.item.title) || b.qty - a.qty);
  const body = rows.length
    ? `<div class="card"><table>
        <tr><th>Design</th><th>Variant</th><th>SKU</th><th>Qty</th><th>Orders</th></tr>
        ${rows
          .map(
            (r) => `<tr>
              <td><b>${e(r.item.title)}</b>${r.custom ? ' <span class="muted">(has personalisation — see order)</span>' : ''}</td>
              <td>${e(r.item.variantTitle || '—')}</td>
              <td class="muted">${e(r.item.sku || '')}</td>
              <td style="font-size:20px;font-weight:800">${r.qty}</td>
              <td class="muted">${e([...r.orders].join(', '))}</td>
            </tr>`,
          )
          .join('')}
      </table></div>`
    : `<div class="card empty">Nothing to print right now.</div>`;
  return layout({ title: 'Pick list', tab: 'picklist', body });
}

export function printedPage({ shopDomain, printed }) {
  const body = printed.length
    ? printed.map((q) => orderCard(shopDomain, q, { actions: false })).join('')
    : `<div class="card empty">No printed orders yet.</div>`;
  return layout({ title: 'Printed', tab: 'printed', body });
}

export function messagePage(title, message) {
  return layout({ title, tab: '', body: `<div class="card empty">${e(message)}</div>` });
}
