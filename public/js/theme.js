// Theme: "light" | "dark". No stored choice follows the OS setting.
const KEY = 'barry-theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  return document.documentElement.dataset.theme;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || meta.content;
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch {}
  applyTheme(next);
}

export function initTheme() {
  mq.addEventListener('change', (e) => {
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch {}
    if (!stored) applyTheme(e.matches ? 'dark' : 'light');
  });
}
