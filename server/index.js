import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { Store } from './store.js';
import { createAuth, hashPassword } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error('ADMIN_PASSWORD is required (see .env.example).');
  process.exit(1);
}

// Storage-budget limits (override with env vars). YouTube links don't count toward the gallery limit.
const GALLERY_PHOTO_LIMIT = Number(process.env.GALLERY_PHOTO_LIMIT) || 50;
const COMMENT_LIMIT = Number(process.env.COMMENT_LIMIT) || 100; // all stored comments (pending + approved)

const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const newId = () => crypto.randomBytes(8).toString('hex');

const store = new Store(DATA_DIR);
await store.init();
if (store.db.settings.portraitId !== undefined) {
  await store.update((db) => {
    const p = db.photos.find((x) => x.id === db.settings.portraitId);
    if (p && !db.settings.avatar) db.settings.avatar = p.file;
    delete db.settings.portraitId;
  });
}
const auth = createAuth({
  password: PASSWORD, // initial password; replaced by one set in the admin (settings.admin) once that exists
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  getAdmin: () => store.db.settings.admin,
});

const app = express();
app.set('trust proxy', 1); // behind Caddy
app.disable('x-powered-by');
// Content-Security-Policy. The two pages each have one small inline script (theme, before first paint); they are
// allowed by hash, computed from the files at startup, so editing them never needs a manual update here.
const inlineScriptHashes = [];
for (const page of ['index.html', 'admin/index.html']) {
  const html = await fs.readFile(path.join(ROOT, 'public', page), 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    inlineScriptHashes.push(`'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`);
}
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${inlineScriptHashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // 'unsafe-inline': a few style="" attributes
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "frame-src https://www.youtube-nocookie.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY'); // older browsers; frame-ancestors covers the rest
  if (req.path.startsWith('/api/admin')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '100kb' }));

// ---- helpers ---------------------------------------------------------------

// Rate-limit key: an IPv4 address as it is; an IPv6 address by its /64 prefix (one customer gets a whole /64,
// so the full address is free to change on every request).
function ipKey(ip = '') {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = ipKey(req.ip);
    const h = hits.get(key) ?? { n: 0, reset: now + windowMs };
    if (h.reset < now) Object.assign(h, { n: 0, reset: now + windowMs });
    hits.set(key, h);
    if (++h.n > max) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const upUrl = (file) => `/uploads/${file}`;
// A gallery item is either an uploaded photo (file) or a YouTube video (youtubeId).
const publicPhoto = (p) =>
  p.youtubeId
    ? { id: p.id, type: 'video', youtubeId: p.youtubeId, caption: p.caption }
    : { id: p.id, type: 'photo', url: upUrl(p.file), w: p.w ?? null, h: p.h ?? null, caption: p.caption };

// Accepts watch, youtu.be, shorts, live and embed links. Returns the 11-char id or null.
function parseYouTubeId(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, rest] = url.pathname.split('/');
    id = kind === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(kind) ? rest : null;
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id ?? '') ? id : null;
}
const publicComment = (c) => ({
  id: c.id,
  name: c.name,
  message: c.message,
  createdAt: c.createdAt,
  editedAt: c.editedAt ?? null, // set only when the admin changed the name or message
  photoUrl: c.photo ? upUrl(c.photo) : null,
});

// An uploaded file can be shared (a gallery photo that is also the avatar).
const inUse = (db, file) =>
  db.settings.avatar === file || db.settings.closing === file || db.photos.some((p) => p.file === file) || db.comments.some((c) => c.photo === file) || (db.diary ?? []).some((d) => d.photo === file) ||
  Object.values(db.settings.icons ?? {}).some((i) => i?.type === 'image' && i.value === file);
const rmUpload = (file) => fs.rm(path.join(store.uploads, file), { force: true });
const rmIfUnused = async (file) => {
  if (file && !inUse(store.db, file)) await rmUpload(file);
};

// Every upload is decoded, auto-rotated, shrunk to fit `maxSide` and re-encoded as WebP; the original
// is deleted. This (not the client) is what keeps stored files small, and it also strips EXIF
// metadata such as GPS location from visitors' photos. A file that cannot be decoded is rejected.
sharp.cache(false);
sharp.concurrency(1); // small VM: process one image at a time
const MAX_INPUT_PIXELS = 50_000_000; // refuse bigger pictures before they are decoded (a decode needs about 4 bytes per pixel; the container has 450 MB)
async function optimizeImages(files, maxSide) {
  const made = [];
  try {
    for (const f of files) {
      const out = `${newId()}.webp`;
      const src = path.join(store.uploads, f.filename);
      const frames = (await sharp(src, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).pages ?? 1;
      const info = await sharp(src, { limitInputPixels: MAX_INPUT_PIXELS, ...(frames > 1 ? { animated: true, pages: Math.min(frames, 100) } : {}) }) // animated GIFs stay animated, capped at 100 frames
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(path.join(store.uploads, out));
      made.push(out);
      f.width = info.width; // callers may store the size (the gallery layout needs it before the image loads)
      f.height = info.pageHeight ?? info.height;
      await rmUpload(f.filename);
      f.filename = out; // callers read the new name from the multer file object
    }
    return true;
  } catch {
    await Promise.all([...files.map((f) => rmUpload(f.filename)), ...made.map(rmUpload)]);
    return false;
  }
}
// Longest side, in pixels, per kind of image.
const MAX_SIDE = { gallery: 2000, guest: 1600, slot: 1200, icon: 256 };

// Gallery photos remember their pixel size (the justified layout needs it before images load).
// Photos uploaded before that was stored get it read once at startup.
{
  const missing = store.db.photos.filter((p) => p.file && !(p.w > 0 && p.h > 0));
  if (missing.length) {
    const sizes = new Map();
    for (const p of missing) {
      try {
        const m = await sharp(path.join(store.uploads, p.file)).metadata();
        sizes.set(p.id, { w: m.width, h: m.pageHeight ?? m.height });
      } catch {} // unreadable file: the client falls back to a 4:3 box
    }
    await store.update((db) => {
      for (const p of db.photos) if (sizes.has(p.id)) Object.assign(p, sizes.get(p.id));
    });
  }
}

const imageUpload = ({ maxMB, files }) =>
  multer({
    storage: multer.diskStorage({
      destination: store.uploads,
      filename: (req, file, cb) => cb(null, newId() + (EXT[file.mimetype] ?? '')),
    }),
    limits: { fileSize: maxMB * 1024 * 1024, files, fields: 10 },
    fileFilter: (req, file, cb) =>
      file.mimetype in EXT ? cb(null, true) : cb(Object.assign(new Error('invalid_image'), { status: 400 })),
  });

function cleanCaption(input) {
  const out = {};
  for (const l of LANGS) out[l] = str(input?.[l], 200);
  return out;
}

// Diary: admin-written memories, per-language title/text, optional photo.
const DIARY_LIMIT = Number(process.env.DIARY_ENTRY_LIMIT) || 100;
const cleanLangMap = (input, max) => Object.fromEntries(LANGS.map((l) => [l, str(input?.[l], max)]));
function cleanDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
// Timeline date: 'YYYY-MM-DD' or 'YYYY-MM' (month only), or '' for none. Returns null when invalid.
function cleanTimelineDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  return cleanDate(v);
}
const diaryOrder = (list) => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
// Diary "check-in": a place name (required), plus optional address and map coordinates picked from the place search.
function cleanLocation(v) {
  if (!v || typeof v !== 'object') return null;
  const name = str(v.name, 120);
  if (!name) return null;
  const num = (x, limit) => {
    const n = typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : NaN;
    return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 1e6) / 1e6 : null;
  };
  const lat = num(v.lat, 90);
  const lon = num(v.lon, 180);
  return { name, address: str(v.address, 300), lat: lat === null || lon === null ? null : lat, lon: lat === null || lon === null ? null : lon };
}
const publicDiary = (d) => ({ id: d.id, date: d.date, title: d.title, text: d.text, location: d.location ?? null, photoUrl: d.photo ? upUrl(d.photo) : null, youtubeId: d.youtubeId ?? null });

// Configurable small icons: slot -> { type: 'preset' | 'emoji' | 'image', value }. No entry = built-in paw.
const ICON_SLOTS = ['brand', 'badge'];
const PRESET_ICONS = ['paw', 'heart', 'star', 'sakura', 'moon']; // artwork lives in public/js/icons.js
function cleanIcon(body) {
  if (body?.type === 'preset' && PRESET_ICONS.includes(body.value)) return { type: 'preset', value: body.value };
  if (body?.type === 'emoji') {
    const v = str(body.value, 8);
    if (v && !/[<>&"'`]/.test(v)) return { type: 'emoji', value: v }; // rendered with textContent only
  }
  return null;
}
const publicIcons = (icons = {}) =>
  Object.fromEntries(ICON_SLOTS.map((k) => [k, icons[k] ? { type: icons[k].type, value: icons[k].type === 'image' ? upUrl(icons[k].value) : icons[k].value } : null]));

const galleryPhotoCount = (db) => db.photos.filter((p) => p.file).length;
const limitsFor = (db) => ({
  gallery: { used: galleryPhotoCount(db), max: GALLERY_PHOTO_LIMIT },
  comments: { used: db.comments.length, max: COMMENT_LIMIT },
  diary: { used: (db.diary ?? []).length, max: DIARY_LIMIT },
});

function cleanContent(input) {
  const out = {};
  if (Array.isArray(input.story)) out.story = input.story.slice(0, 20).map((s) => str(s, 3000)).filter(Boolean);
  if (Array.isArray(input.loved)) out.loved = input.loved.slice(0, 30).map((s) => str(s, 100)).filter(Boolean);
  if (Array.isArray(input.timeline))
    out.timeline = input.timeline
      .slice(0, 50)
      .map((t) => ({ year: str(t?.year, 20), date: cleanTimelineDate(t?.date), text: str(t?.text, 500) })) // year = title, date (optional YYYY-MM-DD or YYYY-MM) = subtitle
      .filter((t) => t.text)
      .map((t) => {
        // Stored data is exact: a bad year or date is refused, never silently dropped.
        const y = Number(t.year);
        if (!/^\d{4}$/.test(t.year) || y < 1900 || y > 2100 || t.date === null || (t.date && !t.date.startsWith(`${t.year}-`))) throw Object.assign(new Error('invalid_timeline'), { status: 400 });
        return t;
      });
  if (typeof input.tribute === 'string') out.tribute = str(input.tribute, 500);
  if (typeof input.memory === 'string') out.memory = str(input.memory, 80); // small line above the big name
  if (typeof input.name === 'string') out.name = str(input.name, 40); // shown as the big name on the first page
  return out;
}

const approvedNewestFirst = (comments) =>
  comments.filter((c) => c.status === 'approved').sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// Admin-editable palette. Only these variables, only #rrggbb: values are interpolated into CSS.
const THEME_KEYS = { bg: '--bg', bg2: '--bg-2', ink: '--ink', muted: '--muted', accent: '--accent', gold: '--gold', card: '--card', line: '--line' };
function cleanTheme(input) {
  const out = {};
  for (const mode of ['light', 'dark']) {
    out[mode] = {};
    for (const key of Object.keys(THEME_KEYS)) {
      const v = input?.[mode]?.[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[mode][key] = v.toLowerCase();
    }
  }
  return out;
}
function themeCss(theme = {}) {
  const block = (mode) => {
    const decl = Object.entries(theme[mode] ?? {}).map(([k, v]) => `${THEME_KEYS[k]}:${v}`);
    return decl.length ? `:root[data-theme="${mode}"]{${decl.join(';')}}` : '';
  };
  return `/* admin theme overrides */\n${block('light')}\n${block('dark')}\n`;
}

// Built-in presets (read-only). Admins can duplicate one into an editable custom theme.
const BUILTIN_THEMES = [
  { id: 'default', name: 'Warm (default)', light: {}, dark: {} },
  {
    id: 'sakura', name: 'Sakura',
    light: { bg: '#fff7f8', bg2: '#fdecef', ink: '#3b2530', muted: '#8a6b76', accent: '#d9577a', gold: '#c98aa0', card: '#ffffff', line: '#f3d5dc' },
    dark: { bg: '#170e12', bg2: '#20141a', ink: '#f7e9ee', muted: '#b79aa6', accent: '#ff8fb0', gold: '#e0a6bb', card: '#26181f', line: '#3b2630' },
  },
  {
    id: 'lavender', name: 'Lavender',
    light: { bg: '#fbf6f8', bg2: '#f3eaf3', ink: '#2f2236', muted: '#7a6686', accent: '#8a5aab', gold: '#c49a6c', card: '#fffcfb', line: '#e6d6ec' },
    dark: { bg: '#150f1a', bg2: '#1c1423', ink: '#f3eaf7', muted: '#b5a0c1', accent: '#c79bea', gold: '#e0b98a', card: '#21172a', line: '#34253f' },
  },
];
const MAX_THEMES = 20;
const allThemes = (db) => [...BUILTIN_THEMES, ...(db.settings.themes ?? [])];
const activeTheme = (db) => allThemes(db).find((t) => t.id === db.settings.activeThemeId) ?? BUILTIN_THEMES[0];

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---- public API ------------------------------------------------------------

app.get('/api/site', (req, res) => {
  const { content, photos, comments, settings } = store.db;
  res.json({
    content,
    avatarUrl: settings.avatar ? upUrl(settings.avatar) : null,
    closingUrl: settings.closing ? upUrl(settings.closing) : null,
    avatarPos: settings.avatarPos ?? null,
    closingPos: settings.closingPos ?? null,
    photos: photos.map(publicPhoto),
    diary: diaryOrder(store.db.diary ?? []).map(publicDiary),
    icons: publicIcons(settings.icons),
  });
});

const COMMENTS_PER_PAGE = 10;
const COMMENT_MAX_CHARS = Number(process.env.COMMENT_MAX_CHARS) || 500; // longest message a visitor can send (shown as a counter on the form)
app.get('/api/comments', (req, res) => {
  const all = approvedNewestFirst(store.db.comments);
  const pages = Math.max(1, Math.ceil(all.length / COMMENTS_PER_PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  res.json({
    page,
    pages,
    total: all.length,
    full: store.db.comments.length >= COMMENT_LIMIT, // the form is switched off when true
    maxChars: COMMENT_MAX_CHARS,
    items: all.slice((page - 1) * COMMENTS_PER_PAGE, page * COMMENTS_PER_PAGE).map(publicComment),
  });
});

const guestUpload = imageUpload({ maxMB: 8, files: 1 });
const MAX_PENDING_PHOTOS = 30; // unreviewed guest photos waiting at once
const MAX_PENDING_COMMENTS = Number(process.env.PENDING_COMMENT_LIMIT) || 40; // unreviewed comments waiting at once; keeps spam from using up every slot of COMMENT_LIMIT

app.post(
  '/api/comments',
  rateLimit({ windowMs: 10 * 60_000, max: 5 }),
  rateLimit({ windowMs: 24 * 60 * 60_000, max: 12 }), // one visitor (or one spammer) cannot send more than this a day
  guestUpload.single('photo'),
  wrap(async (req, res) => {
    const reject = async (status, error) => {
      if (req.file) await rmUpload(req.file.filename);
      return res.status(status).json({ error });
    };
    if (req.body?.website) return reject(201, undefined); // honeypot: pretend success
    const name = str(req.body?.name, 40);
    const message = str(req.body?.message, COMMENT_MAX_CHARS + 1);
    if (!name || !message) return reject(400, 'name_and_message_required');
    if (message.length > COMMENT_MAX_CHARS) return reject(400, 'message_too_long'); // rejected, never silently cut
    // Returns why the submission can't be stored, or null.
    const blocked = (db) =>
      db.comments.length >= COMMENT_LIMIT ? 'comments_full'
      : db.comments.filter((c) => c.status === 'pending').length >= MAX_PENDING_COMMENTS ? 'comments_busy'
      : req.file && db.comments.filter((c) => c.photo && c.status === 'pending').length >= MAX_PENDING_PHOTOS ? 'photos_busy'
      : null;
    const why = blocked(store.db);
    if (why) return reject(503, why); // cheap check before the expensive image work
    if (req.file && !(await optimizeImages([req.file], MAX_SIDE.guest))) return res.status(400).json({ error: 'invalid_image' });
    const file = req.file?.filename;
    const stored = await store.update((db) => {
      const why2 = blocked(db); // re-check: another request may have filled the last slot meanwhile
      if (why2) return why2;
      db.comments.push({
        id: newId(), name, message, photo: file ?? null, status: 'pending', createdAt: new Date().toISOString(),
      });
      return null;
    });
    if (stored) return reject(503, stored);
    res.status(201).json({ ok: true });
  })
);

app.use(
  '/uploads',
  express.static(store.uploads, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' })
);

// ---- admin API -------------------------------------------------------------

const admin = express.Router();

admin.post(
  '/login',
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  wrap(async (req, res) => {
    if (!(await auth.checkPassword(req.body?.password))) return res.status(401).json({ error: 'invalid_password' });
    auth.login(req, res);
    res.json({ ok: true });
  })
);
admin.post('/logout', (req, res) => {
  auth.logout(res);
  res.json({ ok: true });
});
admin.get('/me', (req, res) => res.json({ authed: auth.isAuthed(req) }));

admin.use(auth.require);

const MIN_PASSWORD = 10;
admin.post(
  '/password',
  rateLimit({ windowMs: 15 * 60_000, max: 10 }), // it checks the current password, so it is rate-limited like login
  wrap(async (req, res) => {
    const { current, next } = req.body ?? {};
    if (!(await auth.checkPassword(current))) return res.status(403).json({ error: 'wrong_current_password' });
    if (typeof next !== 'string' || next.length < MIN_PASSWORD || next.length > 200) return res.status(400).json({ error: 'password_too_short' });
    if (next === current) return res.status(400).json({ error: 'password_unchanged' });
    const hash = await hashPassword(next);
    await store.update((db) => {
      db.settings.admin = { hash, version: (db.settings.admin?.version ?? 0) + 1, changedAt: new Date().toISOString() };
    });
    auth.login(req, res); // new session for this browser; every other session is now invalid
    res.json({ ok: true });
  })
);

admin.get('/data', (req, res) => {
  const { content, photos, comments, settings } = store.db;
  res.json({
    content,
    account: { passwordChangedAt: settings.admin?.changedAt ?? null },
    limits: limitsFor(store.db),
    diary: diaryOrder(store.db.diary ?? []).map(publicDiary),
    icons: publicIcons(settings.icons),
    themes: { builtin: BUILTIN_THEMES, custom: settings.themes ?? [], activeId: activeTheme(store.db).id },
    avatarUrl: settings.avatar ? upUrl(settings.avatar) : null,
    closingUrl: settings.closing ? upUrl(settings.closing) : null,
    avatarPos: settings.avatarPos ?? null,
    closingPos: settings.closingPos ?? null,
    photos: photos.map(publicPhoto),
    comments: [...comments]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...publicComment(c), status: c.status })),
  });
});

admin.put(
  '/content/:lang',
  wrap(async (req, res) => {
    const { lang } = req.params;
    if (!LANGS.includes(lang)) return res.status(400).json({ error: 'bad_lang' });
    const clean = cleanContent(req.body ?? {});
    await store.update((db) => {
      db.content[lang] = clean;
    });
    res.json(clean);
  })
);

const upload = imageUpload({ maxMB: 12, files: 20 });

admin.post(
  '/photos',
  upload.array('photos', 20),
  wrap(async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'no_valid_images' });
    const tooMany = async () => {
      await Promise.all(req.files.map((f) => rmUpload(f.filename)));
      const used = galleryPhotoCount(store.db);
      return res.status(400).json({ error: 'gallery_full', used, max: GALLERY_PHOTO_LIMIT, room: Math.max(0, GALLERY_PHOTO_LIMIT - used) });
    };
    if (galleryPhotoCount(store.db) + req.files.length > GALLERY_PHOTO_LIMIT) return tooMany(); // before the expensive image work
    if (!(await optimizeImages(req.files, MAX_SIDE.gallery))) return res.status(400).json({ error: 'invalid_image' });
    const created = await store.update((db) => {
      if (galleryPhotoCount(db) + req.files.length > GALLERY_PHOTO_LIMIT) return null; // lost a race with another upload
      return req.files.map((f) => {
        const photo = { id: newId(), file: f.filename, w: f.width, h: f.height, caption: cleanCaption({}), createdAt: new Date().toISOString() };
        db.photos.push(photo);
        return publicPhoto(photo);
      });
    });
    if (!created) return tooMany();
    res.status(201).json(created);
  })
);

admin.post(
  '/videos',
  wrap(async (req, res) => {
    const youtubeId = parseYouTubeId(req.body?.url);
    if (!youtubeId) return res.status(400).json({ error: 'invalid_youtube_url' });
    const video = await store.update((db) => {
      const item = { id: newId(), file: null, youtubeId, caption: cleanCaption({}), createdAt: new Date().toISOString() };
      db.photos.push(item);
      return publicPhoto(item);
    });
    res.status(201).json(video);
  })
);

admin.post(
  '/photos/reorder',
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await store.update((db) => {
      const byId = new Map(db.photos.map((p) => [p.id, p]));
      const ordered = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
      const rest = db.photos.filter((p) => !ids.includes(p.id));
      db.photos = [...new Set([...ordered, ...rest])];
    });
    res.json({ ok: true });
  })
);

admin.patch(
  '/photos/:id',
  wrap(async (req, res) => {
    const found = await store.update((db) => {
      const p = db.photos.find((x) => x.id === req.params.id);
      if (p) p.caption = cleanCaption(req.body?.caption);
      return Boolean(p);
    });
    res.status(found ? 200 : 404).json(found ? { ok: true } : { error: 'not_found' });
  })
);

admin.delete(
  '/photos/:id',
  wrap(async (req, res) => {
    const file = await store.update((db) => {
      const i = db.photos.findIndex((x) => x.id === req.params.id);
      if (i < 0) return null;
      const [p] = db.photos.splice(i, 1);
      return p.file;
    });
    if (!file) return res.status(404).json({ error: 'not_found' });
    await rmIfUnused(file);
    res.json({ ok: true });
  })
);

const themeName = (v) => str(v, 40) || 'Untitled';

admin.post(
  '/themes',
  wrap(async (req, res) => {
    const t = { id: newId(), name: themeName(req.body?.name), ...cleanTheme(req.body) };
    const ok = await store.update((db) => {
      db.settings.themes ??= [];
      if (db.settings.themes.length >= MAX_THEMES) return false;
      db.settings.themes.push(t);
      return true;
    });
    res.status(ok ? 201 : 400).json(ok ? t : { error: 'too_many_themes' });
  })
);

admin.put(
  '/themes/active',
  wrap(async (req, res) => {
    const ok = await store.update((db) => {
      if (!allThemes(db).some((t) => t.id === req.body?.id)) return false;
      db.settings.activeThemeId = req.body.id;
      return true;
    });
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'not_found' });
  })
);

admin.put(
  '/themes/:id',
  wrap(async (req, res) => {
    const t = await store.update((db) => {
      const found = (db.settings.themes ?? []).find((x) => x.id === req.params.id); // built-ins are read-only
      if (found) Object.assign(found, { name: themeName(req.body?.name) }, cleanTheme(req.body));
      return found;
    });
    res.status(t ? 200 : 404).json(t ?? { error: 'not_found' });
  })
);

admin.delete(
  '/themes/:id',
  wrap(async (req, res) => {
    const ok = await store.update((db) => {
      const i = (db.settings.themes ?? []).findIndex((x) => x.id === req.params.id);
      if (i < 0) return false;
      db.settings.themes.splice(i, 1);
      if (db.settings.activeThemeId === req.params.id) db.settings.activeThemeId = 'default';
      return true;
    });
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'not_found' });
  })
);

// ---- diary (admin) ----
// Place search for the diary check-in. Proxied through the server so the browser never talks to a third party
// and OpenStreetMap's Nominatim policy is met (identifying User-Agent, at most one request per second).
let lastPlaceSearch = 0;
admin.get(
  '/places',
  wrap(async (req, res) => {
    const q = str(req.query.q, 100);
    if (!q) return res.json([]);
    if (Date.now() - lastPlaceSearch < 1100) return res.status(429).json({ error: 'slow_down' });
    lastPlaceSearch = Date.now();
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'en';
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({ format: 'jsonv2', q, limit: '6', 'accept-language': lang }).toString();
      const r = await fetch(url, { headers: { 'User-Agent': 'BarryForever-memorial/1.0 (private memorial site, admin place search)' }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const found = await r.json();
      res.json(
        (Array.isArray(found) ? found : []).slice(0, 6).map((p) => ({
          name: str(p.name || String(p.display_name ?? '').split(',')[0], 120),
          address: str(p.display_name, 300),
          lat: Number(p.lat),
          lon: Number(p.lon),
        })).filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      );
    } catch {
      res.status(502).json({ error: 'search_unavailable' });
    }
  })
);
admin.post(
  '/diary',
  wrap(async (req, res) => {
    const date = cleanDate(req.body?.date);
    if (!date) return res.status(400).json({ error: 'invalid_date' });
    const youtubeId = str(req.body?.youtube, 300) ? parseYouTubeId(req.body.youtube) : null;
    if (str(req.body?.youtube, 300) && !youtubeId) return res.status(400).json({ error: 'invalid_youtube_url' });
    const entry = {
      id: newId(), date, title: cleanLangMap(req.body?.title, 120), text: cleanLangMap(req.body?.text, 8000),
      location: cleanLocation(req.body?.location), photo: null, youtubeId, createdAt: new Date().toISOString(),
    };
    const ok = await store.update((db) => {
      db.diary ??= [];
      if (db.diary.length >= DIARY_LIMIT) return false;
      db.diary.push(entry);
      return true;
    });
    res.status(ok ? 201 : 400).json(ok ? publicDiary(entry) : { error: 'too_many_entries' });
  })
);

admin.put(
  '/diary/:id',
  wrap(async (req, res) => {
    const date = cleanDate(req.body?.date);
    if (!date) return res.status(400).json({ error: 'invalid_date' });
    // A memory has a photo or a YouTube video, never both: `youtube` omitted = unchanged, '' = remove the video, a link = set it (and drop the photo).
    const link = typeof req.body?.youtube === 'string' ? str(req.body.youtube, 300) : undefined;
    const youtubeId = link ? parseYouTubeId(link) : null;
    if (link && !youtubeId) return res.status(400).json({ error: 'invalid_youtube_url' });
    let oldPhoto = null;
    const entry = await store.update((db) => {
      const d = (db.diary ?? []).find((x) => x.id === req.params.id);
      if (!d) return undefined;
      Object.assign(d, { date, title: cleanLangMap(req.body?.title, 120), text: cleanLangMap(req.body?.text, 8000), location: cleanLocation(req.body?.location) });
      if (link !== undefined) d.youtubeId = youtubeId;
      if (youtubeId && d.photo) { oldPhoto = d.photo; d.photo = null; }
      return d;
    });
    if (oldPhoto) await rmIfUnused(oldPhoto);
    res.status(entry ? 200 : 404).json(entry ? publicDiary(entry) : { error: 'not_found' });
  })
);

admin.delete(
  '/diary/:id',
  wrap(async (req, res) => {
    const removed = await store.update((db) => {
      const i = (db.diary ?? []).findIndex((x) => x.id === req.params.id);
      return i >= 0 ? db.diary.splice(i, 1)[0] : null;
    });
    if (!removed) return res.status(404).json({ error: 'not_found' });
    await rmIfUnused(removed.photo);
    res.json({ ok: true });
  })
);

const diaryPhotoUpload = imageUpload({ maxMB: 12, files: 1 }).single('photo');
admin.post(
  '/diary/:id/photo',
  diaryPhotoUpload,
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_valid_images' });
    if (!store.db.diary?.some((x) => x.id === req.params.id)) {
      await rmUpload(req.file.filename);
      return res.status(404).json({ error: 'not_found' });
    }
    if (!(await optimizeImages([req.file], MAX_SIDE.gallery))) return res.status(400).json({ error: 'invalid_image' });
    const prev = await store.update((db) => {
      const d = db.diary.find((x) => x.id === req.params.id);
      if (!d) return undefined;
      const old = d.photo;
      d.photo = req.file.filename;
      d.youtubeId = null; // photo or video, not both
      return old ?? null;
    });
    if (prev === undefined) {
      await rmUpload(req.file.filename);
      return res.status(404).json({ error: 'not_found' });
    }
    await rmIfUnused(prev);
    res.json({ photoUrl: upUrl(req.file.filename) });
  })
);

admin.delete(
  '/diary/:id/photo',
  wrap(async (req, res) => {
    const prev = await store.update((db) => {
      const d = (db.diary ?? []).find((x) => x.id === req.params.id);
      if (!d) return undefined;
      const old = d.photo;
      d.photo = null;
      return old ?? null;
    });
    if (prev === undefined) return res.status(404).json({ error: 'not_found' });
    await rmIfUnused(prev);
    res.json({ ok: true });
  })
);

// ---- icons (admin) ----
admin.put(
  '/icons/:slot',
  wrap(async (req, res) => {
    if (!ICON_SLOTS.includes(req.params.slot)) return res.status(404).json({ error: 'not_found' });
    const icon = req.body?.type === 'default' ? null : cleanIcon(req.body);
    if (req.body?.type !== 'default' && !icon) return res.status(400).json({ error: 'invalid_icon' });
    const prev = await store.update((db) => {
      db.settings.icons ??= {};
      const old = db.settings.icons[req.params.slot];
      if (icon) db.settings.icons[req.params.slot] = icon;
      else delete db.settings.icons[req.params.slot];
      return old;
    });
    if (prev?.type === 'image') await rmIfUnused(prev.value);
    res.json(publicIcons(store.db.settings.icons));
  })
);

const iconUpload = imageUpload({ maxMB: 4, files: 1 }).single('icon');
admin.post(
  '/icons/:slot/image',
  iconUpload,
  wrap(async (req, res) => {
    if (!ICON_SLOTS.includes(req.params.slot)) {
      if (req.file) await rmUpload(req.file.filename);
      return res.status(404).json({ error: 'not_found' });
    }
    if (!req.file) return res.status(400).json({ error: 'no_valid_images' });
    if (!(await optimizeImages([req.file], MAX_SIDE.icon))) return res.status(400).json({ error: 'invalid_image' });
    const prev = await store.update((db) => {
      db.settings.icons ??= {};
      const old = db.settings.icons[req.params.slot];
      db.settings.icons[req.params.slot] = { type: 'image', value: req.file.filename };
      return old;
    });
    if (prev?.type === 'image') await rmIfUnused(prev.value);
    res.json(publicIcons(store.db.settings.icons));
  })
);

// Single-image settings ("avatar" = hero portrait, "closing" = photo on the last page).
// Each can be uploaded directly, picked from the gallery, or cleared.
function imageSetting(key) {
  const single = imageUpload({ maxMB: 8, files: 1 }).single(key);
  admin.post(
    `/${key}`,
    single,
    wrap(async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'no_valid_images' });
      if (!(await optimizeImages([req.file], MAX_SIDE.slot))) return res.status(400).json({ error: 'invalid_image' });
      const old = await store.update((db) => {
        const prev = db.settings[key];
        db.settings[key] = req.file.filename;
        delete db.settings[`${key}Pos`]; // new picture: back to centred
        return prev;
      });
      await rmIfUnused(old);
      res.json({ url: upUrl(req.file.filename) });
    })
  );
  // Which part of the picture stays visible in the round crop: { x, y, zoom }: x/y in percent (50/50 = centre), zoom 1-3.
  admin.put(
    `/${key}/position`,
    wrap(async (req, res) => {
      const clamp = (n) => Math.min(100, Math.max(0, Math.round(Number(n))));
      const x = clamp(req.body?.x);
      const y = clamp(req.body?.y);
      const zoom = Math.min(3, Math.max(1, Math.round((Number(req.body?.zoom) || 1) * 100) / 100));
      if (Number.isNaN(x) || Number.isNaN(y)) return res.status(400).json({ error: 'bad_position' });
      await store.update((db) => {
        db.settings[`${key}Pos`] = { x, y, zoom };
      });
      res.json({ x, y, zoom });
    })
  );
  admin.put(
    `/${key}`,
    wrap(async (req, res) => {
      const id = req.body?.photoId ?? null;
      const result = await store.update((db) => {
        const photo = id === null ? null : db.photos.find((p) => p.id === id);
        if (id !== null && !photo?.file) return { ok: false }; // videos can't be used
        const prev = db.settings[key];
        db.settings[key] = photo ? photo.file : null;
        delete db.settings[`${key}Pos`];
        return { ok: true, prev };
      });
      if (!result.ok) return res.status(404).json({ error: 'not_found' });
      await rmIfUnused(result.prev);
      res.json({ ok: true });
    })
  );
}
imageSetting('avatar');
imageSetting('closing');

// Approve / unpublish, and/or edit the visitor's name and message. A real change stamps `editedAt`, which both the
// site and the admin show as "(edited <date>)" so a visitor's words are never changed silently.
const ADMIN_MESSAGE_MAX = 2000;
admin.patch(
  '/comments/:id',
  wrap(async (req, res) => {
    const { status } = req.body ?? {};
    if (status !== undefined && !['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'bad_status' });
    const name = req.body?.name === undefined ? undefined : str(req.body.name, 40);
    const message = req.body?.message === undefined ? undefined : str(req.body.message, ADMIN_MESSAGE_MAX + 1);
    if (name === '' || message === '') return res.status(400).json({ error: 'name_and_message_required' });
    if (message && message.length > ADMIN_MESSAGE_MAX) return res.status(400).json({ error: 'message_too_long' });
    const found = await store.update((db) => {
      const c = db.comments.find((x) => x.id === req.params.id);
      if (!c) return null;
      if (status) c.status = status;
      const changed = (name !== undefined && name !== c.name) || (message !== undefined && message !== c.message);
      if (changed) {
        if (name !== undefined) c.name = name;
        if (message !== undefined) c.message = message;
        c.editedAt = new Date().toISOString();
      }
      return { ...publicComment(c), status: c.status };
    });
    res.status(found ? 200 : 404).json(found ?? { error: 'not_found' });
  })
);

admin.delete(
  '/comments/:id',
  wrap(async (req, res) => {
    const removed = await store.update((db) => {
      const i = db.comments.findIndex((x) => x.id === req.params.id);
      return i >= 0 ? db.comments.splice(i, 1)[0] : null;
    });
    if (!removed) return res.status(404).json({ error: 'not_found' });
    await rmIfUnused(removed.photo);
    res.json({ ok: true });
  })
);

admin.delete(
  '/comments/:id/photo',
  wrap(async (req, res) => {
    const file = await store.update((db) => {
      const c = db.comments.find((x) => x.id === req.params.id);
      if (!c) return undefined;
      const prev = c.photo;
      c.photo = null;
      return prev ?? null;
    });
    if (file === undefined) return res.status(404).json({ error: 'not_found' });
    await rmIfUnused(file);
    res.json({ ok: true });
  })
);

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// ---- static site -----------------------------------------------------------

app.get('/theme-overrides.css', (req, res) => {
  res.type('text/css').set('Cache-Control', 'no-cache').send(themeCss(activeTheme(store.db)));
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.redirect('/admin/'));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code });
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(err.status || 500).json({ error: 'server_error' });
});

if (store.db.settings.theme) {
  // Older single-palette setting becomes the first custom theme, and stays active.
  await store.update((db) => {
    const t = { id: newId(), name: 'My theme', ...cleanTheme(db.settings.theme) };
    db.settings.themes = [...(db.settings.themes ?? []), t];
    db.settings.activeThemeId = t.id;
    delete db.settings.theme;
  });
}
app.listen(PORT, () => console.log(`Barry's memorial running on http://localhost:${PORT}`));
