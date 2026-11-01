import fs from 'node:fs';
import path from 'node:path';

/**
 * Keeps the list of customer stores that have installed the app, in a small
 * JSON file (on Render this lives on a persistent disk). It only holds store
 * names and dates — no customer data and no access tokens.
 *
 * The list also heals itself: any genuine webhook or app visit from a store
 * re-adds it, so even if the file were lost, stores reappear on their own.
 */
export function createShopStore(dataDir) {
  const file = path.join(dataDir, 'shops.json');
  let shops = {};
  try {
    shops = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    shops = {};
  }

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(shops, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    /** Record that a store has the app (or update its name). Returns true if it's new. */
    upsert(shop, { name } = {}) {
      const existing = shops[shop];
      const isNew = !existing || !!existing.uninstalledAt;
      shops[shop] = {
        ...existing,
        name: name || existing?.name || shop.replace(/\.myshopify\.com$/, ''),
        installedAt: isNew ? new Date().toISOString() : existing.installedAt,
        uninstalledAt: null,
      };
      if (isNew || name !== existing?.name) save();
      return isNew;
    },
    markUninstalled(shop) {
      if (!shops[shop]) return;
      shops[shop].uninstalledAt = new Date().toISOString();
      save();
    },
    remove(shop) {
      if (!shops[shop]) return;
      delete shops[shop];
      save();
    },
    get(shop) {
      return shops[shop] || null;
    },
    active() {
      return Object.entries(shops)
        .filter(([, s]) => !s.uninstalledAt)
        .map(([shop, s]) => ({ shop, ...s }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    all() {
      return Object.entries(shops).map(([shop, s]) => ({ shop, ...s }));
    },
  };
}
