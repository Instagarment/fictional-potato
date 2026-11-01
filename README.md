# 🖨️ Print Tracker for Shopify

Print Tracker is for T-shirt shops that print some designs on demand and keep others in stock.

When an order comes in that contains a print-on-demand item, Print Tracker:

1. **Sends you an email.** It lists the design, size and colour, quantity, SKU, any personalisation the customer entered (for example "Name on back: ALEX"), the order note, and a button that opens the order in Shopify.
2. **Tags the order `needs-printing` in Shopify,** so you can filter your Orders page down to only the orders you have to print.
3. **Adds the order to a print queue page.** You tick items off there as you print them. When everything in an order is printed, the order's tag changes to `printed`.

Orders that only contain in-stock products are ignored. You won't get emails for them.

### Pages

| Page | What it shows |
|---|---|
| **To print** | Every order with something left to print, oldest first. Each item has a **Printed ✓** button, and each order has **Mark all printed**. |
| **Pick list** | Totals across all orders waiting to be printed, for printing in batches. For example: "Sunset Tee · Black / L · **4**". |
| **Printed** | Orders you've finished recently. |

The **Scan** button on the To print page checks older orders, from the last 7, 30 or 60 days. Use it once after installing to catch orders that came in before you set the app up.

### Nothing is stored on this server

All the tracking lives in your Shopify store, as order tags plus a small hidden note (a metafield) recording which items are printed. You can redeploy, restart or move this app without losing anything.

---

## How it decides what's print-on-demand

**Add the tag `print-on-demand` to those products in Shopify.**

To tag many products at once: in Shopify admin go to **Products**, tick the products, then choose **⋯ → Add tags** and enter `print-on-demand`.

You can also, or instead, track by SKU. If all your print-on-demand SKUs start with something like `POD-`, set `TRACK_SKU_PREFIXES=POD-`.

---

## Setup

You'll need about 20 minutes. There are five steps.

### 1. Create the Shopify app

1. Go to **[dev.shopify.com](https://dev.shopify.com)** and log in with your store account. Click **Apps → Create app**, and name it something like "Print Tracker".
2. In the app's **Versions** section, create a version with these **access scopes**:
   - `read_orders`
   - `write_orders` (needed to add the `needs-printing` / `printed` tags)
   - `read_products` (needed to read product tags)

   Release the version.
3. Under **API access / Protected customer data**, request access to protected customer data. Order data counts as customer data. If you want the customer's name in the email, also request the **Name** field (and **Address** if you want their city).
4. **Install** the app on your store.
5. Open the app's **Settings** page and copy the **Client ID** and **Client secret**. You'll paste them in at step 3.

### 2. Get an email password

The easiest option is Gmail:

1. Turn on 2-step verification for your Google account.
2. Go to **Google Account → Security → App passwords** and create one.
3. Use that 16-character password as `SMTP_PASS`.

Any other email provider that gives you SMTP settings also works. That includes Outlook, Zoho, your web host, SendGrid, Mailgun and Resend.

### 3. Put the app online

The app has to run somewhere with a public web address so Shopify can reach it.

**Render (easiest):**

1. Push this repo to GitHub.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. Fill in the settings it asks for. See `.env.example` for what each one means.
4. After the first deploy, copy your app's address (for example `https://print-tracker-abcd.onrender.com`). Set it as `APP_URL` and redeploy.

The `starter` plan stays awake. On the free plan, the app goes to sleep when it isn't being used, so alerts can arrive late. The built-in catch-up check finds any orders that were missed while it slept.

It also runs on Railway, Fly.io, a VPS, or anything else that runs Node.js 22 or newer: `npm ci && npm start`.

### 4. Connect your store's orders to the app

Run this once, after `APP_URL` is set. Use your host's **Shell** tab, or run it on your computer with a filled-in `.env` file:

```bash
npm run register-webhook
```

From then on, Shopify sends every new order to the app straight away.

### 5. Test it

```bash
npm run test-email     # sends a sample alert so you can check your email settings
```

Then:

1. Open your `APP_URL` and log in with `DASHBOARD_PASSWORD`. The username can be anything.
2. Click **Scan** to pull in recent orders.
3. Place a test order for a tagged product. You should get the email within a few seconds.

---

## Running it on your computer

```bash
cp .env.example .env   # then fill it in
npm install
npm start              # http://localhost:3000
npm test               # automated tests (no Shopify connection needed)
```

Shopify can't send orders to `localhost`. To receive live orders while running locally, expose the app with a tunnel such as `cloudflared tunnel --url http://localhost:3000`, and use the tunnel's https address as `APP_URL`.

## How it works

```
New order in Shopify ──webhook──▶ /webhooks/orders-create
                                     │  check Shopify's signature
                                     │  load order + product tags
                                     ▼
                        any print-on-demand items?
                          │ no → ignore
                          │ yes
                          ├─▶ tag order "needs-printing" in Shopify
                          └─▶ send email alert
Print queue page ◀── orders tagged "needs-printing"
"Printed ✓" ──▶ save in order metafield; when all done → tag "printed"
```

| File | What it does |
|---|---|
| `src/tracker.js` | Decides which items count as print-on-demand; handles tagging, the queue and scanning |
| `src/email.js` | Builds and sends the alert email |
| `src/views.js` | The dashboard pages |
| `src/server.js` | Web server: the webhook, the dashboard and the catch-up timer |
| `src/shopify.js` | Shopify API access (client credentials grant) and webhook signature check |
