/* Kate Taylor theme: menu drawer, product-type filter chips, variant picker and add-to-bag. */
(() => {
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  /* Menu drawer */
  const drawer = document.getElementById('MenuDrawer');
  const opener = document.querySelector('[data-menu-open]');
  if (drawer && opener) {
    const close = () => {
      drawer.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      opener.focus();
    };
    opener.addEventListener('click', () => {
      drawer.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      const first = drawer.querySelector('a, button');
      if (first) first.focus();
    });
    drawer.querySelectorAll('[data-menu-close]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) close();
    });
  }

  /* Product type filter chips */
  document.querySelectorAll('[data-collection-filter]').forEach((block) => {
    const chips = block.querySelectorAll('[data-filter]');
    const cards = block.querySelectorAll('.product-card[data-type]');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.filter;
        chips.forEach((c) => {
          const active = c === chip;
          c.classList.toggle('is-active', active);
          c.setAttribute('aria-pressed', String(active));
        });
        cards.forEach((card) => {
          card.hidden = value !== 'all' && card.dataset.type !== value;
        });
      });
    });
  });

  /* Product page */
  const product = document.querySelector('[data-product]');
  if (!product) return;

  const form = product.querySelector('[data-product-form]');
  const jsonEl = product.querySelector('[data-product-json]');
  const idInput = product.querySelector('[data-variant-id]');
  const priceEl = product.querySelector('[data-price]');
  const addButton = product.querySelector('[data-add-button]');
  const status = product.querySelector('[data-form-status]');
  const strings = {
    add: addButton ? addButton.textContent.trim() : 'Add to bag',
  };
  const variants = jsonEl ? JSON.parse(jsonEl.textContent) : [];
  const money = (cents) => {
    try {
      const currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
      return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'currency', currency }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2);
    }
  };

  const selectedOptions = () => {
    const values = [];
    product.querySelectorAll('input[data-option-index]:checked').forEach((input) => {
      values[Number(input.dataset.optionIndex)] = input.value;
    });
    return values;
  };

  const updateVariant = () => {
    const opts = selectedOptions();
    const variant = variants.find((v) => v.options.every((o, i) => o === opts[i]));
    if (!variant) {
      if (addButton) { addButton.disabled = true; addButton.textContent = 'Unavailable'; }
      return;
    }
    idInput.value = variant.id;
    if (priceEl) priceEl.textContent = money(variant.price);
    if (addButton) {
      addButton.disabled = !variant.available;
      addButton.textContent = variant.available ? strings.add : 'Sold out';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant.id);
    window.history.replaceState({}, '', url);
  };

  product.querySelectorAll('input[data-option-index]').forEach((input) => input.addEventListener('change', updateVariant));

  if (form && window.fetch) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (addButton) { addButton.disabled = true; addButton.textContent = 'Adding…'; }
      if (status) status.textContent = '';
      try {
        const res = await fetch(`${root}cart/add.js`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.description || data.message || 'Could not add to bag.');
        const cart = await (await fetch(`${root}cart.js`, { headers: { Accept: 'application/json' } })).json();
        document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = cart.item_count; });
        if (status) status.innerHTML = `Added to your bag. <a href="${root}cart">View bag</a>`;
      } catch (err) {
        if (status) status.textContent = err.message;
      } finally {
        if (addButton) { addButton.disabled = false; addButton.textContent = strings.add; }
        if (product.querySelector('input[data-option-index]')) updateVariant();
      }
    });
  }
})();
