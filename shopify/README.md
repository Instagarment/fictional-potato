# Kate Taylor store (Shopify)

A Shopify theme and product list for Kate Taylor's official merch store, built from the
"silver chrome" concept: a dark background, the chrome blackletter logo, hot-pink accents, and a
"New releases · The collection" grid of decks, posters and T-shirts with filter buttons.

| File | What it is |
|---|---|
| `kate-taylor-theme.zip` | The theme, ready to upload to Shopify |
| `kate-taylor-theme/` | The theme's source files (the same as the zip) |
| `kate-taylor-products.csv` | The 12 products from the concept, ready to import |

## 1. Upload the theme

1. In the Kate Taylor Shopify admin, go to **Online Store → Themes**.
2. Under **Theme library**, click **Add theme → Upload zip file** and pick `kate-taylor-theme.zip`.
3. Click **Customize** on the new theme:
   - **Hero image**: add the photo of Kate. If there's a separate portrait crop for phones, add it as the **Phone image**.
   - **Product collection**: leave **Collection** empty to show every product, or pick one.
   - **Footer**: add the Instagram / TikTok / X links.
   - **Theme settings** (the paintbrush icon): change the colours and fonts if needed.
4. When you're happy, click **Publish**.

The silver logo is built into the theme. To use a different file, set **Header → Logo**.

## 2. Import the products

1. Go to **Products → Import** and upload `kate-taylor-products.csv`.
2. Every product is imported as a **draft**, so nothing appears in the store until it's ready.
3. Open each product, add its pictures, and set it to **Active**.

Notes on the product list:

- **Prices** are the placeholder prices from the concept: $89 decks, $29 posters and $35 T-shirts.
- **T-shirt sizes** are S, M, L, XL and 2XL. Edit these if you offer different sizes.
- **Product weight is not set.** If shipping is charged by weight, add a weight to each product before launch.
- **Stock isn't tracked**, so items never sell out, which suits print on demand. Turn on inventory tracking for anything held in stock.
- The filter buttons and counts ("4 Skateboards · 4 Posters · 4 T-Shirts") come from each product's **Type**. Keep the types as `Skateboard`, `Poster` and `T-Shirt`, or add new ones; the buttons update automatically.

## 3. Before launch

- Add a **Main menu** under **Online Store → Navigation**. It opens from the **Menu** button. Until one exists, the menu shows Home, Shop all and Bag.
- Set up payments, shipping and taxes in **Settings**.
- To have Instagarment print the T-shirts automatically, install the **Instagarment Print on Demand** app (see the main README) and add the T-shirts to it.
- While the store is password protected, visitors see a "coming soon" page with the logo and an email sign-up.

## Checking theme changes

Run Shopify's theme checker before uploading a changed theme:

```sh
npx @shopify/cli theme check --path shopify/kate-taylor-theme
```

Rebuild the zip from inside the theme folder, so the theme's folders sit at the top level of the zip:

```sh
cd shopify/kate-taylor-theme && rm -f ../kate-taylor-theme.zip && zip -r ../kate-taylor-theme.zip . -x '.*'
```
