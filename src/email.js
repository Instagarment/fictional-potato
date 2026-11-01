import nodemailer from 'nodemailer';
import { adminOrderUrl } from './tracker.js';
import { escapeHtml } from './html.js';

export function createMailer({ email, shopDomain, appUrl }) {
  const { smtp } = email;
  if (!smtp.host || email.to.length === 0) {
    console.warn('Email is not configured (SMTP_HOST / ALERT_EMAIL_TO) — alerts will only be logged.');
    return null;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure || smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  async function send({ subject, html, text }) {
    await transport.sendMail({ from: email.from, to: email.to.join(', '), subject, html, text });
  }

  async function sendPrintAlert(order, items) {
    const count = items.reduce((n, i) => n + i.currentQuantity, 0);
    const subject = `🖨️ Print needed: ${order.name} — ${count} item${count === 1 ? '' : 's'}`;
    const orderUrl = adminOrderUrl(shopDomain, order);
    const { html, text } = renderAlert({ order, items, orderUrl, appUrl });
    await send({ subject, html, text });
  }

  return { send, sendPrintAlert, verify: () => transport.verify() };
}

export function renderAlert({ order, items, orderUrl, appUrl }) {
  const who = order.shippingAddress?.name || order.customer?.displayName || '';
  const where = [order.shippingAddress?.city, order.shippingAddress?.provinceCode, order.shippingAddress?.countryCodeV2]
    .filter(Boolean)
    .join(', ');

  const rows = items
    .map((item) => {
      const props = item.customAttributes
        .filter((a) => a.value && !a.key.startsWith('_'))
        .map((a) => `<div style="color:#555;font-size:13px">${escapeHtml(a.key)}: <b>${escapeHtml(a.value)}</b></div>`)
        .join('');
      const img = item.image?.url
        ? `<img src="${escapeHtml(item.image.url)}" width="64" height="64" style="object-fit:cover;border-radius:6px">`
        : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;width:72px">${img}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">
          <div style="font-weight:600">${escapeHtml(item.title)}</div>
          ${item.variantTitle ? `<div style="font-size:14px">${escapeHtml(item.variantTitle)}</div>` : ''}
          ${item.sku ? `<div style="color:#888;font-size:12px">SKU ${escapeHtml(item.sku)}</div>` : ''}
          ${props}
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:20px;font-weight:700;text-align:center">×${item.currentQuantity}</td>
      </tr>`;
    })
    .join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;color:#111">
    <h2 style="margin:0 0 4px">Order ${escapeHtml(order.name)} has items to print</h2>
    <div style="color:#555;margin-bottom:16px">
      ${who ? `${escapeHtml(who)}` : ''}${where ? ` · ${escapeHtml(where)}` : ''}${order.shippingLine?.title ? ` · ${escapeHtml(order.shippingLine.title)}` : ''}
    </div>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    ${order.note ? `<p style="background:#fff8e1;padding:10px;border-radius:6px"><b>Order note:</b> ${escapeHtml(order.note)}</p>` : ''}
    <p style="margin-top:20px">
      <a href="${escapeHtml(orderUrl)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open order in Shopify</a>
      ${appUrl ? `&nbsp; <a href="${escapeHtml(appUrl)}/" style="color:#111">View print queue</a>` : ''}
    </p>
  </div>`;

  const text = [
    `Order ${order.name} has items to print`,
    [who, where].filter(Boolean).join(' · '),
    '',
    ...items.map((item) => {
      const props = item.customAttributes
        .filter((a) => a.value && !a.key.startsWith('_'))
        .map((a) => `\n    ${a.key}: ${a.value}`)
        .join('');
      return `  ${item.currentQuantity} × ${item.title}${item.variantTitle ? ` — ${item.variantTitle}` : ''}${item.sku ? ` (SKU ${item.sku})` : ''}${props}`;
    }),
    '',
    order.note ? `Order note: ${order.note}\n` : '',
    `Open order: ${orderUrl}`,
    appUrl ? `Print queue: ${appUrl}/` : '',
  ].join('\n');

  return { html, text };
}
