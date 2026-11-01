import nodemailer from 'nodemailer';
import { escapeHtml as e } from './html.js';

export function createMailer({ email, appUrl, companyName }) {
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

  async function sendPrintAlert({ shopName, order, items }) {
    const count = items.reduce((n, i) => n + i.currentQuantity, 0);
    const subject = `🖨️ Print needed: ${shopName} ${order.name} — ${count} item${count === 1 ? '' : 's'}`;
    const { html, text } = renderAlert({ shopName, order, items, appUrl, companyName });
    await transport.sendMail({ from: email.from, to: email.to.join(', '), subject, html, text });
  }

  return { sendPrintAlert, verify: () => transport.verify() };
}

function visibleProps(item) {
  return item.customAttributes.filter((a) => a.value && !a.key.startsWith('_'));
}

export function renderAlert({ shopName, order, items, appUrl, companyName = 'Instagarment' }) {
  const who = order.shippingAddress?.name || order.customer?.displayName || '';
  const where = [order.shippingAddress?.city, order.shippingAddress?.provinceCode, order.shippingAddress?.countryCodeV2]
    .filter(Boolean)
    .join(', ');

  const rows = items
    .map((item) => {
      const props = visibleProps(item)
        .map((a) => `<div style="color:#555;font-size:13px">${e(a.key)}: <b>${e(a.value)}</b></div>`)
        .join('');
      const img = item.image?.url
        ? `<img src="${e(item.image.url)}" width="64" height="64" style="object-fit:cover;border-radius:6px">`
        : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;width:72px">${img}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">
          <div style="font-weight:600">${e(item.title)}</div>
          ${item.variantTitle ? `<div style="font-size:14px">${e(item.variantTitle)}</div>` : ''}
          ${item.sku ? `<div style="color:#888;font-size:12px">SKU ${e(item.sku)}</div>` : ''}
          ${props}
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:20px;font-weight:700;text-align:center">×${item.currentQuantity}</td>
      </tr>`;
    })
    .join('');

  const logo = appUrl ? `<img src="${e(appUrl)}/logo.png" width="48" height="48" alt="${e(companyName)}" style="vertical-align:middle">` : '';

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;color:#111">
    <div style="background:#111;color:#FDB913;padding:12px 16px;border-radius:10px 10px 0 0;font-weight:800;font-size:16px">
      ${logo} <span style="vertical-align:middle;margin-left:8px">${e(companyName)} · New print job</span>
    </div>
    <div style="border:1px solid #eee;border-top:0;padding:16px;border-radius:0 0 10px 10px">
      <h2 style="margin:0 0 4px">${e(shopName)} — order ${e(order.name)}</h2>
      <div style="color:#555;margin-bottom:16px">
        ${e([who, where, order.shippingLine?.title].filter(Boolean).join(' · '))}
      </div>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      ${order.note ? `<p style="background:#fff8e1;padding:10px;border-radius:6px"><b>Order note:</b> ${e(order.note)}</p>` : ''}
      <p style="margin-top:20px">
        ${appUrl ? `<a href="${e(appUrl)}/admin" style="background:#FDB913;color:#111;font-weight:700;padding:10px 16px;border-radius:6px;text-decoration:none">Open print queue</a>` : ''}
      </p>
    </div>
  </div>`;

  const text = [
    `${shopName} — order ${order.name} has items to print`,
    [who, where].filter(Boolean).join(' · '),
    '',
    ...items.map((item) => {
      const props = visibleProps(item).map((a) => `\n    ${a.key}: ${a.value}`).join('');
      return `  ${item.currentQuantity} × ${item.title}${item.variantTitle ? ` — ${item.variantTitle}` : ''}${item.sku ? ` (SKU ${item.sku})` : ''}${props}`;
    }),
    '',
    order.note ? `Order note: ${order.note}\n` : '',
    appUrl ? `Print queue: ${appUrl}/admin` : '',
  ].join('\n');

  return { html, text };
}
