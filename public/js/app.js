import { LANGS, detectLang, rememberLang, loadLocale, translator } from './i18n.js';
import { initTheme, toggleTheme, currentTheme } from './theme.js';
import { shrink } from './image.js';
import { iconNode, faviconHref } from './icons.js';
import { normalizeEntry, toStored } from './timeline.js';
import { initMotion, refresh as refreshMotion } from './motion.js';

const BORN = new Date(2011, 7, 20);
const PASSED = new Date(2026, 9, 4);
const $ = (id) => document.getElementById(id);

const state = { lang: 'en', dict: {}, t: (k) => k, site: { content: {}, photos: [], diary: [], icons: {}, avatarUrl: null }, comments: { items: [], page: 1, pages: 1 }, diaryPage: 1, lightbox: { items: [], index: -1 } };

// Webfonts per language, fetched only when that language is shown (Google serves CJK fonts in small slices).
const FONT_CSS = {
  'zh-TW': 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@400;600&display=swap',
  ja: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&family=Noto+Sans+JP:wght@400;600&display=swap',
  ko: 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&display=swap',
};
function loadFonts(lang) {
  const href = FONT_CSS[lang];
  if (!href || document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(el('link', { rel: 'stylesheet', href }));
}

// ---- data ------------------------------------------------------------------

// GET JSON, retrying a couple of times (a flaky connection or a cold server shouldn't leave the page empty). Null on failure.
async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

async function loadComments(page = 1) {
  const data = await getJson(`/api/comments?page=${page}`);
  state.commentsFailed = !data;
  if (data) state.comments = data;
}

async function loadSite() {
  const data = await getJson('/api/site');
  state.siteFailed = !data; // no backend: fall back to the defaults bundled in the locale files
  if (data) state.site = data;
}

// If a load failed (offline, server restarting), try again when the connection is back or the tab is revisited.
async function recoverFailedLoads() {
  if (!state.commentsFailed && !state.siteFailed) return;
  await Promise.all([state.siteFailed && loadSite(), state.commentsFailed && loadComments(state.comments.page)]);
  renderAll();
}

// Admin overrides win; an empty override falls back to the locale default.
const content = (field) => {
  const custom = state.site.content?.[state.lang]?.[field];
  return custom?.length ? custom : state.dict.content?.[field] ?? [];
};

// Barry's name: the admin-set one for this language, else the locale default.
const barryName = () => state.site.content?.[state.lang]?.name || state.t('name');

// Timeline entry: the year is the title, the optional date the subtitle, then the text.
// Older entries stored a date inside the year ("2011-08-20"): split those so they still read well.
function timelineParts({ year = '', date = '' }) {
  let title = String(year).trim();
  let when = date;
  const month = /^(\d{4})[-/.](\d{1,2})$/.exec(title); // "2015-06" typed as the year
  if (month && !when) {
    title = month[1];
    when = `${month[1]}-${month[2].padStart(2, '0')}`;
  }
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?-?$/.exec(when);
  if (!m) return { title, sub: '' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] || 1)];
  const parsed = new Date(y, mo - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== mo - 1 || parsed.getDate() !== d) return { title: String(year).trim(), sub: '' }; // impossible date
  // The year is the title already, so the subtitle shows only month and day (the full date if its year differs from the title).
  const sameYear = title === String(y);
  const opts = m[3] ? (sameYear ? { month: 'long', day: 'numeric' } : { dateStyle: 'long' }) : (sameYear ? { month: 'long' } : { year: 'numeric', month: 'long' });
  return { title, sub: new Intl.DateTimeFormat(state.lang, opts).format(parsed) };
}

// ---- rendering -------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

function lifespan() {
  let y = PASSED.getFullYear() - BORN.getFullYear();
  let m = PASSED.getMonth() - BORN.getMonth();
  let d = PASSED.getDate() - BORN.getDate();
  if (d < 0) { m--; d += new Date(PASSED.getFullYear(), PASSED.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  const { t } = state;
  return t('age.template', { y: t('unit.year', { n: y }), m: t('unit.month', { n: m }), d: t('unit.day', { n: d }) });
}

function renderStatic() {
  const { t, lang } = state;
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  document.querySelector('meta[name=description]').content = t('meta.description');
  document.querySelectorAll('[data-i18n]').forEach((n) => (n.textContent = t(n.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'long' });
  $('dates').textContent = `${fmt.format(BORN)}  ·  ${fmt.format(PASSED)}`;
  $('years').textContent = `${BORN.getFullYear()} — ${PASSED.getFullYear()}`;
  $('age').textContent = lifespan();
  $('lang').ariaLabel = t('lang.label');
  $('lang').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  $('lb-close').ariaLabel = t('common.close');
  $('mem-close').ariaLabel = t('common.close');
  $('lb-prev').ariaLabel = t('lightbox.prev');
  $('lb-next').ariaLabel = t('lightbox.next');
  renderThemeButton();
}

function renderThemeButton() {
  const { t } = state;
  const next = currentTheme() === 'dark' ? 'theme.light' : 'theme.dark';
  const btn = $('theme');
  btn.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
  btn.title = btn.ariaLabel = t('theme.toggle', { mode: t(next) });
}

function renderContent() {
  const name = barryName();
  $('hero-name').textContent = name;
  document.querySelector('.eyebrow').textContent = state.site.content?.[state.lang]?.memory || state.t('hero.memory');
  $('brand-name').textContent = name;
  document.querySelector('.brand').ariaLabel = name;
  $('story-body').replaceChildren(...content('story').map((p) => el('p', { textContent: p })));
  $('loved').replaceChildren(...content('loved').map((s) => el('li', { textContent: s })));
  $('timeline').replaceChildren(
    ...content('timeline').map((raw) => {
      const entry = normalizeEntry(raw);
      const { title, sub } = timelineParts(toStored(entry));
      return el('li', { dataset: { reveal: '' } }, title ? el('strong', { textContent: title }) : '', sub ? el('em', { textContent: sub }) : '', el('span', { textContent: entry.text }));
    }
    )
  );
  const quote = content('tribute') || '';
  $('quote').textContent = quote;
  $('interlude').hidden = !quote;
  renderClosingPhoto(Boolean(quote));
}

function renderClosingPhoto(hasQuote) {
  const url = state.site.closingUrl;
  const box = $('closing-photo');
  box.hidden = !url;
  box.replaceChildren(...(url ? [focalImg(el('img', { src: url, alt: barryName(), loading: 'lazy' }), state.site.closingPos)] : []));
  document.body.classList.toggle('has-quote', hasQuote && !url); // big quote mark (skipped when a photo sits above the quote)
  document.body.classList.toggle('has-closing', hasQuote || Boolean(url)); // full-height closing page
}

function renderIcons() {
  const icons = state.site.icons ?? {};
  $('brand-icon').replaceChildren(iconNode(icons.brand, 'brand'));
  $('badge').replaceChildren(iconNode(icons.badge, 'badge'));
  setFavicon();
}

// The browser-tab icon follows the top-left (brand) icon and the theme's accent colour.
function setFavicon() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || undefined;
  document.querySelector('link[rel=icon]').href = faviconHref(state.site.icons?.brand, accent);
}

function renderPortrait() {
  const box = $('portrait');
  const url = state.site.avatarUrl;
  if (!url) return box.replaceChildren(el('span', { textContent: '🐾', ariaHidden: 'true' }));
  box.replaceChildren(focalImg(el('img', { src: url, alt: barryName() }), state.site.avatarPos));
}

// Admin-chosen centre of a round crop (percent) and zoom; no setting = centred.
function focalImg(img, pos) {
  if (pos) {
    img.style.objectPosition = `${pos.x}% ${pos.y}%`;
    if (pos.zoom > 1) Object.assign(img.style, { transformOrigin: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom})` });
  }
  return img;
}

const caption = (p) => p.caption?.[state.lang] || '';

const galleryItems = () =>
  state.site.photos.map((p) =>
    p.type === 'video'
      ? { video: p.youtubeId, ar: 16 / 9, url: `https://i.ytimg.com/vi/${p.youtubeId}/hqdefault.jpg`, alt: caption(p) || 'YouTube', title: '', caption: caption(p) }
      : { url: p.url, ar: p.w && p.h ? p.w / p.h : 0, alt: caption(p) || barryName(), title: '', caption: caption(p) }
  );

// Photo tile: frame sized to the photo's own ratio (never cropped), caption underneath.
function tile(item, i, items, className) {
  const img = el('img', { src: item.url, alt: item.alt, loading: 'lazy' });
  // Frame takes the photo's own proportions so the whole picture is always visible.
  if (!item.video) img.addEventListener('load', () => frame.style.setProperty('--ar', `${img.naturalWidth} / ${img.naturalHeight}`));
  const frame = el('button', { type: 'button', className: item.video ? 'frame video' : 'frame', onclick: () => openLightbox(items, i), ariaLabel: item.alt }, img);
  if (item.ar && !item.video) frame.style.setProperty('--ar', String(item.ar)); // stored size: no layout jump while the image loads
  if (item.video) frame.append(el('span', { className: 'play', ariaHidden: 'true', textContent: '▶' }));
  const cap = item.title || item.caption
    ? el('p', { className: 'cap' }, item.title ? el('strong', { textContent: item.title }) : '', el('span', { textContent: item.caption }))
    : '';
  return el('figure', { className, dataset: { reveal: '' } }, frame, cap);
}

// ---- gallery: staggered columns, filled so photos read left to right, row by row ----
// Photo 1, 2, 3 go across the first row, then the next row (round-robin into columns; CSS columns would read top to bottom).
const narrow = matchMedia('(max-width: 900px)');
function renderMasonry(grid, items) {
  const cols = Array.from({ length: narrow.matches ? 2 : 3 }, () => el('div', { className: 'mcol' }));
  items.forEach((item, i) => cols[i % cols.length].append(tile(item, i, items, 'tile')));
  grid.replaceChildren(...cols);
}
narrow.addEventListener('change', () => {
  renderMasonry($('grid'), galleryItems());
  refreshMotion();
});

function renderGallery() {
  const photos = galleryItems();
  $('gallery-empty').hidden = photos.length > 0;
  renderMasonry($('grid'), photos);
}

// Message length limit comes from the server (one source); the form shows "typed / max".
function updateMessageLimit() {
  const box = document.querySelector('#tribute-form textarea[name=message]');
  if (state.comments.maxChars) box.maxLength = state.comments.maxChars;
  $('message-count').textContent = `${box.value.length} / ${box.maxLength}`;
}

function renderComments() {
  const { items, page, pages } = state.comments;
  const fmt = new Intl.DateTimeFormat(state.lang, { dateStyle: 'medium' });
  $('comments-empty').hidden = items.length > 0 || Boolean(state.commentsFailed); // don't claim "no comments" when the load failed
  // Messages are shown in full; a visitor's photo (if any) sits under the message and opens in the lightbox.
  const photoItems = items.filter((c) => c.photoUrl).map((c) => ({ id: c.id, url: c.photoUrl, alt: c.name, title: c.name, caption: c.message }));
  $('comments').replaceChildren(
    ...items.map((c) => {
      const photo = photoItems.find((p) => p.id === c.id);
      return el('li', { dataset: { reveal: '' } },
        el('span', { className: 'av', ariaHidden: 'true', textContent: [...c.name][0]?.toUpperCase() ?? '' }),
        el('div', {},
          el('span', { className: 'who', textContent: c.name }),
          el('time', { dateTime: c.createdAt, textContent: fmt.format(new Date(c.createdAt)) }),
          c.editedAt ? el('time', { className: 'edited', dateTime: c.editedAt, textContent: state.t('comments.edited', { date: fmt.format(new Date(c.editedAt)) }) }) : ''),
        el('p', { textContent: c.message }),
        photo ? el('button', { type: 'button', className: 'cphoto', ariaLabel: c.name, onclick: () => openLightbox(photoItems, photoItems.indexOf(photo)) },
          el('img', { src: c.photoUrl, alt: c.name, loading: 'lazy' })) : '');
    })
  );
  updateMessageLimit();
  renderPagination($('pagination'), page, pages, gotoCommentPage);
  // Guestbook at its limit: replace the form with a kind notice.
  $('tribute-form').hidden = Boolean(state.comments.full);
  $('guestbook-full').hidden = !state.comments.full;
  refreshMotion();
}

// 1 … 4 5 [6] 7 8 … 20
function pageList(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out = [];
  let prev = 0;
  for (const n of [...keep].sort((x, y) => x - y)) {
    if (n - prev === 2) out.push(prev + 1); // don't hide a single page behind an ellipsis
    else if (n - prev > 2) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

function renderPagination(nav, page, pages, go) {
  nav.hidden = pages <= 1;
  nav.ariaLabel = state.t('pagination.label');
  if (pages <= 1) return nav.replaceChildren();
  const btn = (text, target, props = {}) =>
    el('button', { type: 'button', textContent: text, disabled: target === null, onclick: () => go(target), ...props });
  nav.replaceChildren(
    btn('‹', page > 1 ? page - 1 : null, { ariaLabel: state.t('pagination.prev'), title: state.t('pagination.prev') }),
    ...pageList(page, pages).map((n) =>
      n === '…'
        ? el('span', { textContent: n, ariaHidden: 'true' })
        : btn(String(n), n === page ? null : n, {
            ariaLabel: state.t('pagination.page', { n }),
            ariaCurrent: n === page ? 'page' : null,
            className: n === page ? 'current' : '',
            disabled: false,
          })
    ),
    btn('›', page < pages ? page + 1 : null, { ariaLabel: state.t('pagination.next'), title: state.t('pagination.next') })
  );
}

async function gotoCommentPage(n) {
  if (n === null) return;
  await loadComments(n);
  renderComments();
  $('comments').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAll() {
  renderStatic();
  renderContent();
  renderPortrait();
  renderIcons();
  renderDiary();
  renderGallery();
  renderComments();
  refreshMotion();
}

// ---- diary ------------------------------------------------------------------

const DIARY_PER_PAGE = 3;
const FALLBACK_ORDER = ['en', 'zh-TW', 'ja', 'ko'];
let clampObserver = null;

// Show the entry in the visitor's language; if the author didn't write that one, use the first language they did.
function pick(map) {
  for (const l of [state.lang, ...FALLBACK_ORDER]) if (map?.[l]) return map[l];
  return '';
}

const entryParts = (d) => {
  const fmt = new Intl.DateTimeFormat(state.lang, { dateStyle: 'long' });
  const [y, m, day] = d.date.split('-').map(Number);
  return {
    date: fmt.format(new Date(y, m - 1, day)),
    title: pick(d.title),
    paragraphs: pick(d.text).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean),
  };
};

// Diary check-in: "📍 Place", linking to the map (exact pin when coordinates were picked, else a search by name).
function placeLink(loc) {
  if (!loc?.name) return '';
  const query = loc.lat != null && loc.lon != null ? `${loc.lat},${loc.lon}` : loc.name;
  return el('a', {
    className: 'entry-place',
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    target: '_blank', rel: 'noopener noreferrer',
    title: loc.address || state.t('diary.map'),
    ariaLabel: `${loc.name}, ${state.t('diary.map')}`,
    textContent: `📍 ${loc.name}`,
  });
}

function renderDiary() {
  const all = state.site.diary ?? [];
  $('diary').hidden = all.length === 0;
  $('nav-memories').hidden = all.length === 0;
  clampObserver?.disconnect();
  if (!all.length) return;
  const pages = Math.ceil(all.length / DIARY_PER_PAGE);
  state.diaryPage = Math.min(Math.max(1, state.diaryPage), pages);
  const shown = all.slice((state.diaryPage - 1) * DIARY_PER_PAGE, state.diaryPage * DIARY_PER_PAGE);
  clampObserver = new ResizeObserver((entries) => {
    for (const { target } of entries) target.closest('.entry').toggleAttribute('data-clamped', target.scrollHeight > target.clientHeight + 2);
  });
  $('entries').replaceChildren(
    ...shown.map((d) => {
      const e = entryParts(d);
      const body = el('div', { className: 'entry-body' }, ...e.paragraphs.map((t) => el('p', { textContent: t })));
      const alt = e.title || e.date;
      const photo = d.youtubeId
        ? el('figure', { className: 'entry-photo entry-video' },
          el('button', { type: 'button', ariaLabel: `${alt}, ${state.t('diary.play')}`, onclick: () => openMemory(d, { play: true }) },
            el('img', { src: ytThumb(d.youtubeId), alt: '', loading: 'lazy' }), el('span', { className: 'play', ariaHidden: 'true', textContent: '▶' })))
        : d.photoUrl ? el('figure', { className: 'entry-photo' },
          el('button', { type: 'button', ariaLabel: `${alt}, ${state.t('diary.open')}`, onclick: () => openMemory(d) },
            el('img', { src: d.photoUrl, alt, loading: 'lazy' }))) : '';
      clampObserver.observe(body);
      return el('article', { className: 'entry', dataset: { reveal: '' } },
        el('div', { className: 'entry-when' }, el('time', { className: 'entry-date', dateTime: d.date, textContent: e.date }), placeLink(d.location)),
        el('div', { className: photo ? 'entry-main has-photo' : 'entry-main' },
          e.title ? el('h4', { className: 'entry-title', textContent: e.title }) : '', body, photo,
          el('button', { type: 'button', className: 'pill entry-open', textContent: state.t('diary.open'), onclick: () => openMemory(d) })));
    })
  );
  renderPagination($('diary-pagination'), state.diaryPage, pages, (n) => {
    if (n === null) return;
    state.diaryPage = n;
    renderDiary();
    $('diary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  refreshMotion();
}

// Full memory in a pop-up (native <dialog>: focus trap and Esc come for free).
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
// The player is created only when the pop-up opens (nothing loads from YouTube before) and removed when it closes.
const ytPlayer = (id, title, autoplay) => el('div', { className: 'entry-photo entry-player' }, el('iframe', {
  src: `https://www.youtube-nocookie.com/embed/${id}?rel=0${autoplay ? '&autoplay=1' : ''}`, title,
  allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true,
  referrerPolicy: 'strict-origin-when-cross-origin', // YouTube refuses embeds without a referrer
}));
function openMemory(d, { play = false } = {}) {
  const e = entryParts(d);
  $('memory-body').replaceChildren(
    el('time', { className: 'entry-date', dateTime: d.date, textContent: e.date }),
    placeLink(d.location),
    e.title ? el('h4', { textContent: e.title }) : '',
    ...e.paragraphs.map((t) => el('p', { textContent: t })),
    d.youtubeId ? ytPlayer(d.youtubeId, e.title || e.date, play)
      : d.photoUrl ? el('figure', { className: 'entry-photo' }, el('img', { src: d.photoUrl, alt: e.title || e.date })) : ''
  );
  $('memory').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  $('memory').showModal();
}

// ---- lightbox --------------------------------------------------------------

function showLightbox() {
  const { items, index } = state.lightbox;
  const item = items[index];
  const lb = $('lightbox');
  if (!item) return (lb.hidden = true);
  const img = lb.querySelector('img');
  img.hidden = Boolean(item.video);
  if (!item.video) {
    img.classList.add('loading'); // fade in once decoded
    img.onload = () => img.classList.remove('loading');
    Object.assign(img, { src: item.url, alt: item.alt });
    if (img.complete) img.classList.remove('loading');
  }
  $('lb-prev').hidden = $('lb-next').hidden = items.length < 2; // nothing to step to
  $('lb-count').textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
  for (const d of [-1, 1]) { const n = items[(index + d + items.length) % items.length]; if (n && !n.video) new Image().src = n.url; } // preload neighbours
  // Embed the player only when opened (privacy: nothing is loaded from YouTube until then).
  $('lb-video').hidden = !item.video;
  $('lb-video').replaceChildren(
    ...(item.video
      ? [el('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${item.video}?autoplay=1&rel=0`,
          title: item.alt,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          allowFullscreen: true,
          referrerPolicy: 'strict-origin-when-cross-origin', // YouTube refuses embeds without a referrer
        })]
      : [])
  );
  $('lb-caption').replaceChildren(
    ...(item.title ? [el('strong', { textContent: item.title }), el('br')] : []),
    document.createTextNode(item.caption)
  );
  $('lb-caption').scrollTop = 0;
  if (lb.hidden) { // lock the page behind: no scrolling, and no jump when the scrollbar disappears
    document.documentElement.style.setProperty('--sbw', `${window.innerWidth - document.documentElement.clientWidth}px`);
    document.documentElement.classList.add('lb-open');
  }
  lb.hidden = false;
}
function openLightbox(items, index) { state.lightbox = { items, index }; showLightbox(); }
function stepLightbox(d) {
  const n = state.lightbox.items.length;
  state.lightbox.index = (state.lightbox.index + d + n) % n;
  showLightbox();
}
function closeLightbox() {
  state.lightbox = { items: [], index: -1 };
  $('lightbox').hidden = true;
  document.documentElement.classList.remove('lb-open');
  $('lb-video').replaceChildren(); // stops playback
}

// ---- language --------------------------------------------------------------

async function setLang(lang, { render = true } = {}) {
  const dict = await loadLocale(lang);
  Object.assign(state, { lang, dict, t: translator(lang, dict) });
  rememberLang(lang);
  loadFonts(lang);
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  history.replaceState(null, '', url);
  if (render) renderAll();
}

// ---- events ----------------------------------------------------------------

function bind() {
  $('lang').replaceChildren(
    ...LANGS.map((l) => {
      const b = el('button', { type: 'button', textContent: l.short, title: l.label, lang: l.code, onclick: () => setLang(l.code) });
      b.dataset.lang = l.code;
      return b;
    })
  );
  $('theme').addEventListener('click', toggleTheme);
  const memory = $('memory');
  $('mem-close').addEventListener('click', () => memory.close());
  memory.addEventListener('click', (e) => { if (e.target === memory) memory.close(); }); // click on the backdrop
  memory.addEventListener('close', () => { document.body.style.overflow = ''; $('memory-body').replaceChildren(); }); // emptied so a playing video stops
  document.addEventListener('themechange', () => { renderThemeButton(); setFavicon(); });

  $('lb-close').addEventListener('click', closeLightbox);
  $('lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('lb-next').addEventListener('click', () => stepLightbox(1));
  $('lightbox').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeLightbox(); });
  // Swipe left/right to step through photos on touch screens.
  let swipe = null;
  $('lightbox').addEventListener('touchstart', (e) => { swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  $('lightbox').addEventListener('touchend', (e) => {
    if (!swipe) return;
    const dx = e.changedTouches[0].clientX - swipe.x;
    const dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepLightbox(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', (e) => {
    if ($('lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  const input = $('photo-input');
  const clearPhoto = () => { input.value = ''; $('photo-preview').hidden = true; };
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return clearPhoto();
    $('photo-preview').querySelector('img').src = URL.createObjectURL(f);
    $('photo-preview').hidden = false;
  });
  $('photo-remove').addEventListener('click', clearPhoto);
  document.querySelector('#tribute-form textarea[name=message]').addEventListener('input', updateMessageLimit);

  $('tribute-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const note = $('form-note');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = state.t('form.sending');
    note.className = 'notice';
    note.textContent = '';
    try {
      const body = new FormData(form);
      const file = input.files[0];
      body.delete('photo');
      if (file) body.append('photo', await shrink(file));
      const res = await fetch('/api/comments', { method: 'POST', body });
      if (!res.ok) throw Object.assign(new Error(), { status: res.status, code: (await res.json().catch(() => ({}))).error });
      form.reset();
      clearPhoto();
      updateMessageLimit();
      note.textContent = state.t('form.thanks');
    } catch (err) {
      note.className = 'notice error';
      const key = err.status === 429 ? 'form.limit'
        : err.code === 'invalid_image' ? 'form.badPhoto'
        : err.code === 'LIMIT_FILE_SIZE' ? 'form.photoTooLarge'
        : err.code === 'comments_full' ? 'form.full'
        : err.code === 'photos_busy' ? 'form.busy'
        : err.code === 'comments_busy' ? 'form.pending'
        : err.code === 'message_too_long' ? 'form.tooLong'
        : 'form.error';
      note.textContent = state.t(key, { n: state.comments.maxChars });
    } finally {
      btn.disabled = false;
      btn.textContent = state.t('form.submit');
    }
  });
}

// The page is drawn by script after its data arrives, so the browser's own scroll restoration runs while the page
// is still short and gives up. Remember the position ourselves and go back to it once the content is in.
const SCROLL_KEY = 'barry.scrollY';
const savedY = (() => { try { return Number(sessionStorage.getItem(SCROLL_KEY)) || 0; } catch { return 0; } })();
history.scrollRestoration = 'manual';
const saveScroll = () => { try { sessionStorage.setItem(SCROLL_KEY, String(Math.round(scrollY))); } catch { /* private mode */ } };

async function restoreScroll() {
  // A reload keeps the visitor's position even when the URL has a #section (clicked earlier from the nav);
  // a fresh visit to a #section link goes to that section instead.
  const reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const target = location.hash && !reloaded ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (!target && !savedY) return;
  const top = () => (target ? target.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(target).scrollMarginTop) || 0) : savedY);
  let touched = false;
  const stop = () => { touched = true; };
  addEventListener('wheel', stop, { once: true, passive: true });
  addEventListener('touchstart', stop, { once: true, passive: true });
  // Photos and cards keep changing the page height for a moment, so try again until it holds.
  for (let i = 0; i < 12 && !touched; i++) {
    const y = top();
    scrollTo({ top: y, behavior: 'instant' });
    if (Math.abs(scrollY - y) < 2 && i >= 3) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  removeEventListener('wheel', stop);
  removeEventListener('touchstart', stop);
}

initTheme();
initMotion();
bind();
// Render once, after the language file AND the data have arrived (rendering as soon as the language was ready
// drew an empty page whenever the comments or site data were slower, and nothing redrew it later).
await Promise.all([loadSite(), loadComments(1), setLang(detectLang(), { render: false })]);
renderAll();
await restoreScroll();
addEventListener('scroll', saveScroll, { passive: true });
addEventListener('pagehide', saveScroll);
addEventListener('online', recoverFailedLoads);
document.addEventListener('visibilitychange', () => { if (!document.hidden) recoverFailedLoads(); });
