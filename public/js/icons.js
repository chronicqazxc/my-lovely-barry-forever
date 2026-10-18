// Configurable small icons (top-left brand mark, avatar badge). Shared by the site and the admin.
// Preset ids must match PRESET_ICONS in server/index.js. Artwork is fixed markup, never user input.
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;

export const PRESETS = {
  paw: svg('<ellipse cx="5.5" cy="10.5" rx="2" ry="2.6"/><ellipse cx="9.5" cy="6.4" rx="2" ry="2.7"/><ellipse cx="14.5" cy="6.4" rx="2" ry="2.7"/><ellipse cx="18.5" cy="10.5" rx="2" ry="2.6"/><path d="M12 12.4c-3 0-6 3-6 5.2 0 1.8 1.6 2.3 3 2 1-.2 1.9-.6 3-.6s2 .4 3 .6c1.4.3 3-.2 3-2 0-2.2-3-5.2-6-5.2z"/>'),
  heart: svg('<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'),
  star: svg('<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>'),
  sakura: svg([0, 72, 144, 216, 288].map((a) => `<ellipse cx="12" cy="6.2" rx="3.1" ry="4.6" transform="rotate(${a} 12 12)"/>`).join('') + '<circle cx="12" cy="12" r="1.6" fill-opacity=".35"/>'),
  moon: svg('<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>'),
};
export const PRESET_IDS = Object.keys(PRESETS);

// Built-in defaults per slot: the real 🐾 emoji in the top bar (it is what the site started with, and it
// renders in each device's own emoji font), a single paw drawing on the avatar badge.
export const DEFAULT_ICON = { brand: { type: 'emoji', value: '🐾' }, badge: { type: 'preset', value: 'paw' } };

// cfg: { type: 'preset' | 'emoji' | 'image', value }, or null for the slot's default.
export function iconNode(cfg, slot = 'badge') {
  const c = cfg ?? DEFAULT_ICON[slot];
  const box = document.createElement('span');
  box.className = `icon icon-${c.type}`;
  if (c.type === 'image') {
    const img = document.createElement('img');
    Object.assign(img, { src: c.value, alt: '', loading: 'lazy' });
    box.append(img);
  } else if (c.type === 'emoji') {
    box.textContent = c.value; // text only
  } else {
    box.innerHTML = PRESETS[c.value] ?? PRESETS.paw;
  }
  return box;
}

// Browser-tab icon that follows the brand icon. `accent` colours preset artwork.
export function faviconHref(cfg, accent = '#b8613a') {
  const c = cfg ?? DEFAULT_ICON.brand;
  if (c.type === 'image') return c.value;
  const markup = c.type === 'emoji'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${c.value.replace(/[<>&]/g, '')}</text></svg>`
    : (PRESETS[c.value] ?? PRESETS.paw).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('currentColor', accent);
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}
