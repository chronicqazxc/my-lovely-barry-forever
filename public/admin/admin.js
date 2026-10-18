import { shrink } from '/js/image.js';
import { PRESET_IDS, DEFAULT_ICON, iconNode } from '/js/icons.js';
import { normalizeEntry, validateEntry, toStored } from '/js/timeline.js';

const LANGS = [
  ['en', 'English'],
  ['zh-TW', '繁體中文（台灣）'],
  ['ja', '日本語'],
  ['ko', '한국어'],
];
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const { dataset, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  Object.assign(n.dataset, dataset);
  n.append(...kids);
  return n;
};

const TABS = ['content', 'photos', 'comments', 'diary', 'theme'];
let data = { content: {}, photos: [], comments: [], avatarUrl: null };

// Upload with real progress (fetch can't report it): resolves/rejects like api().
function apiUpload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin${path}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.onload = () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 401) { showLogin(); return reject(new Error('unauthorized')); }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(json);
      const err = new Error(json.error || xhr.statusText);
      Object.assign(err, json);
      reject(err);
    };
    xhr.send(form);
  });
}

// Blocks the whole page (modal dialog, Escape ignored) while photos are prepared and sent, with a progress bar.
const busyDialog = $('busy-dialog');
busyDialog.addEventListener('cancel', (e) => e.preventDefault());
async function withBusy(title, job) {
  $('busy-title').textContent = title;
  const show = (text, fraction) => {
    $('busy-text').textContent = text;
    if (fraction == null) $('busy-bar').removeAttribute('value'); // indeterminate
    else $('busy-bar').value = Math.round(fraction * 100);
  };
  show('Starting…', null);
  busyDialog.showModal();
  try {
    return await job(show);
  } finally {
    busyDialog.close();
  }
}

// Deleting photos, comments or memories asks twice: a warning, then a final "are you sure". Resolves true only
// when both are confirmed. Escape or Cancel at either step means no.
const confirmDialog = $('confirm-dialog');
const DELETE_WORDS = { title: 'Delete?', warning: 'This cannot be undone.', yes: 'Yes, delete permanently' };
const confirmDelete = (what) => confirmTwice(what, DELETE_WORDS);
function confirmTwice(what, { title, warning, yes }) {
  return new Promise((resolve) => {
    let step = 1;
    const paint = () => {
      $('confirm-title').textContent = step === 1 ? title : 'Are you absolutely sure?';
      $('confirm-text').textContent = step === 1 ? what : `${what} ${warning}`;
      $('confirm-yes').textContent = step === 1 ? 'Continue' : yes;
    };
    const done = (answer) => {
      confirmDialog.removeEventListener('close', onClose);
      $('confirm-yes').onclick = $('confirm-no').onclick = null;
      if (confirmDialog.open) confirmDialog.close();
      resolve(answer);
    };
    const onClose = () => done(false);
    confirmDialog.addEventListener('close', onClose);
    $('confirm-no').onclick = () => done(false);
    $('confirm-yes').onclick = () => { if (step === 1) { step = 2; paint(); $('confirm-no').focus(); } else done(true); };
    paint();
    confirmDialog.showModal();
    $('confirm-no').focus(); // the safe choice is focused, never the delete button
  });
}

// Shrink files one by one, then POST them, reporting both phases to the dialog.
async function prepareAndSend(files, shrinkTo, build, send, show) {
  const prepared = [];
  for (const [i, f] of files.entries()) {
    show(`Preparing photo ${i + 1} of ${files.length}…`, i / files.length);
    prepared.push(await shrink(f, shrinkTo));
  }
  const form = build(prepared);
  show('Uploading… 0%', 0);
  const res = await send(form, (fraction) =>
    fraction >= 1 ? show('Finishing up on the server…', null) : show(`Uploading… ${Math.round(fraction * 100)}%`, fraction)
  );
  return res;
}

async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const say = (id, text, error = false) => {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
};

// ---- auth / shell ----------------------------------------------------------

function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
}

async function boot() {
  const { authed } = await fetch('/api/admin/me').then((r) => r.json());
  if (!authed) return showLogin();
  $('login').hidden = true;
  $('app').hidden = false;
  await refresh();
  selectTab(location.hash.slice(1) || 'content');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { password: new FormData(e.target).get('password') } });
    e.target.reset();
    say('login-msg', '');
    boot();
  } catch {
    say('login-msg', 'Wrong password.', true);
  }
});
$('logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); showLogin(); });

function selectTab(name) {
  if (!TABS.includes(name)) name = 'content';
  history.replaceState(null, '', `#${name}`);
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const s of TABS) $(`tab-${s}`).hidden = s !== name;
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

function renderTheme() {
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
}
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('barry-theme', next); } catch {}
  renderTheme();
});
renderTheme();

async function refresh() {
  data = await api('/data');
  renderSlots();
  renderLimits();
  renderThemeForm();
  renderIconSlots();
  renderDiaryAdmin();
  renderPhotos();
  renderComments();
  loadContentForm();
}

// ---- photos ----------------------------------------------------------------

function galleryFullMessage() {
  const { used, max } = data.limits.gallery;
  return used >= max
    ? `The gallery is full (${max} photos). Delete a photo to add another. YouTube links don't count.`
    : `Only ${max - used} more photo(s) fit in the gallery (limit ${max}). Choose fewer, or delete some first.`;
}

function renderLimits() {
  const { gallery, comments, diary } = data.limits;
  $('gallery-count').textContent = `Gallery photos: ${gallery.used} / ${gallery.max} (YouTube links don't count)`;
  $('gallery-count').classList.toggle('error', gallery.used >= gallery.max);
  $('comments-count').textContent = `Comments stored: ${comments.used} / ${comments.max}. Visitors can't post once it's full, so delete old or unwanted ones.`;
  $('comments-count').classList.toggle('error', comments.used >= comments.max);
  $('drop').classList.toggle('disabled', gallery.used >= gallery.max);
  $('diary-count').textContent = `Memories: ${diary.used} / ${diary.max}`;
  $('diary-count').classList.toggle('error', diary.used >= diary.max);
  $('diary-new').disabled = diary.used >= diary.max;
}

async function upload(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  if (data.limits.gallery.used + list.length > data.limits.gallery.max) return say('upload-msg', galleryFullMessage(), true);
  say('upload-msg', '');
  try {
    await withBusy(`Uploading ${list.length} photo${list.length === 1 ? '' : 's'}`, (show) =>
      prepareAndSend(list, 2000, (files) => { const form = new FormData(); files.forEach((f) => form.append('photos', f)); return form; }, (form, onProgress) => apiUpload('/photos', form, onProgress), show)
    );
    say('upload-msg', 'Uploaded.');
    await refresh();
  } catch (err) {
    say('upload-msg', err.message === 'gallery_full' ? galleryFullMessage() : `Upload failed: ${err.message}`, true);
  }
}
$('file').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); upload(e.dataTransfer.files); });

// Single-image slots: "avatar" (hero) and "closing" (last page). Upload, or pick from the gallery below.
const SLOTS = { avatar: 'avatarUrl', closing: 'closingUrl' };

// Photo placement inside the round crop: pos = { x, y, zoom }. x/y are object-position percents; zoom grows the photo from that spot.
// The public site applies the same two rules (focalImg in app.js), so the circle here is what visitors get.
function applyPos(img, { x, y, zoom = 1 }) {
  img.style.objectPosition = `${x}% ${y}%`;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = zoom > 1 ? `scale(${zoom})` : '';
}

function renderSlots() {
  for (const [key, urlKey] of Object.entries(SLOTS)) {
    const img = data[urlKey] ? el('img', { src: data[urlKey], alt: key }) : null;
    if (img) applyPos(img, { x: 50, y: 50, ...data[`${key}Pos`] });
    $(`${key}-preview`).replaceChildren(img ?? el('span', { textContent: '🐾' }));
    $(`${key}-focus`).hidden = !img;
    $(`${key}-remove`).hidden = !data[urlKey];
  }
}

// "Adjust photo" dialog (Instagram-style): drag the photo inside a circle, slider to resize.
const focusDialog = $('focus-dialog');
const focusImg = $('focus-img');
const focusView = $('focus-view');
let focusKey = null;
let focusPos = { x: 50, y: 50, zoom: 1 };
let drag = null;

const showFocus = () => {
  applyPos(focusImg, focusPos);
  $('focus-zoom').value = focusPos.zoom;
};

focusView.addEventListener('pointerdown', (e) => {
  const r = focusView.getBoundingClientRect();
  const cover = Math.max(r.width / focusImg.naturalWidth, r.height / focusImg.naturalHeight);
  // How far the zoomed photo can travel, in px: dragging moves it 1:1 under the pointer.
  drag = {
    sx: e.clientX, sy: e.clientY, start: { ...focusPos },
    ox: focusImg.naturalWidth * cover * focusPos.zoom - r.width,
    oy: focusImg.naturalHeight * cover * focusPos.zoom - r.height,
  };
  focusView.setPointerCapture(e.pointerId);
});
focusView.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const move = (from, delta, over) => (over > 0.5 ? Math.min(100, Math.max(0, from - (delta / over) * 100)) : from);
  focusPos = { ...focusPos, x: Math.round(move(drag.start.x, e.clientX - drag.sx, drag.ox)), y: Math.round(move(drag.start.y, e.clientY - drag.sy, drag.oy)) };
  showFocus();
});
const endDrag = () => { drag = null; };
focusView.addEventListener('pointerup', endDrag);
focusView.addEventListener('pointercancel', endDrag);
$('focus-zoom').addEventListener('input', (e) => {
  focusPos = { ...focusPos, zoom: Number(e.target.value) };
  showFocus();
});
$('focus-reset').addEventListener('click', () => {
  focusPos = { x: 50, y: 50, zoom: 1 };
  showFocus();
});
$('focus-cancel').addEventListener('click', () => focusDialog.close());
$('focus-save').addEventListener('click', async () => {
  try {
    await api(`/${focusKey}/position`, { method: 'PUT', body: focusPos });
    focusDialog.close();
    await refresh();
    say(`${focusKey}-msg`, 'Saved.');
  } catch (err) {
    say('focus-msg', `Failed: ${err.message}`, true);
  }
});

for (const key of Object.keys(SLOTS)) {
  $(`${key}-focus`).addEventListener('click', () => {
    focusKey = key;
    focusPos = { x: 50, y: 50, zoom: 1, ...data[`${key}Pos`] };
    $('focus-msg').textContent = '';
    focusImg.src = data[SLOTS[key]];
    showFocus();
    focusDialog.showModal();
  });
}

for (const key of Object.keys(SLOTS)) {
  $(`${key}-file`).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    say(`${key}-msg`, '');
    try {
      await withBusy('Uploading photo', (show) =>
        prepareAndSend([f], 1200, (files) => { const form = new FormData(); form.append(key, files[0]); return form; }, (form, onProgress) => apiUpload(`/${key}`, form, onProgress), show)
      );
      say(`${key}-msg`, 'Updated.');
      await refresh();
    } catch (err) {
      say(`${key}-msg`, `Upload failed: ${err.message}`, true);
    }
  });
  $(`${key}-remove`).addEventListener('click', async () => {
    await api(`/${key}`, { method: 'PUT', body: { photoId: null } });
    say(`${key}-msg`, 'Removed.');
    await refresh();
  });
}

$('video-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('video-msg', 'Adding…');
  try {
    await api('/videos', { method: 'POST', body: { url: $('video-url').value } });
    $('video-url').value = '';
    say('video-msg', 'Video added.');
    await refresh();
  } catch (err) {
    say('video-msg', err.message === 'invalid_youtube_url' ? 'That doesn’t look like a YouTube link.' : `Failed: ${err.message}`, true);
  }
});

async function move(index, delta) {
  const ids = data.photos.map((p) => p.id);
  const j = index + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[index], ids[j]] = [ids[j], ids[index]];
  await api('/photos/reorder', { method: 'POST', body: { ids } });
  await refresh();
}

// Drag and drop ordering: grab the "Drag to reorder" bar, drop on another card (before it if you are on its
// left half, after it on the right half). The arrow buttons stay as the touch / keyboard way.
let dragFrom = -1;

// Browsers scroll inconsistently while dragging, so do it ourselves: near the top or bottom edge of the window the
// page scrolls (faster the closer the pointer is to the edge) until the drag ends.
const EDGE = 100;
let dragY = null;
let scrollTimer = 0;
const trackDrag = (e) => { dragY = e.clientY; };
function autoScroll() {
  if (dragY != null) {
    const near = dragY < EDGE ? dragY - EDGE : dragY > innerHeight - EDGE ? dragY - (innerHeight - EDGE) : 0;
    if (near) window.scrollBy(0, Math.round(Math.max(-1, Math.min(1, near / EDGE)) * 22));
  }
  scrollTimer = requestAnimationFrame(autoScroll);
}
function startAutoScroll() {
  document.addEventListener('dragover', trackDrag);
  cancelAnimationFrame(scrollTimer);
  scrollTimer = requestAnimationFrame(autoScroll);
}
function stopAutoScroll() {
  document.removeEventListener('dragover', trackDrag);
  cancelAnimationFrame(scrollTimer);
  dragY = null;
}
const clearDropMarks = () => $('photos').querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
async function dropPhoto(to) {
  stopAutoScroll();
  const from = dragFrom;
  dragFrom = -1;
  if (from < 0 || to === from || to === from + 1) return;
  const ids = data.photos.map((p) => p.id);
  const [id] = ids.splice(from, 1);
  ids.splice(to > from ? to - 1 : to, 0, id);
  try {
    await api('/photos/reorder', { method: 'POST', body: { ids } });
    say('upload-msg', 'Order saved.');
  } catch (err) {
    say('upload-msg', `Failed: ${err.message}`, true);
  }
  await refresh();
}

function renderPhotos() {
  $('photos').replaceChildren(
    ...data.photos.map((p, i) => {
      const inputs = LANGS.map(([code, label]) =>
        el('label', {}, label.split('（')[0].slice(0, 7), el('input', { value: p.caption[code] ?? '', maxLength: 200, dataset: { lang: code }, placeholder: 'Short description of this photo' }))
      );
      const body = el('div', { className: 'body' }, ...inputs);
      const act = (text, fn, cls = '') => el('button', { type: 'button', textContent: text, className: cls, onclick: fn });
      const isVideo = p.type === 'video';
      const isPortrait = !isVideo && data.avatarUrl === p.url;
      const isClosing = !isVideo && data.closingUrl === p.url;
      body.append(
        el('div', { className: 'acts' },
          act('Save captions', async () => {
            const caption = Object.fromEntries([...body.querySelectorAll('input')].map((n) => [n.dataset.lang, n.value]));
            await api(`/photos/${p.id}`, { method: 'PATCH', body: { caption } });
            say('upload-msg', 'Captions saved.');
          }, 'primary'),
          ...(isVideo ? [] : [
            act(isPortrait ? 'Remove as avatar' : 'Use as avatar', async () => {
              await api('/avatar', { method: 'PUT', body: { photoId: isPortrait ? null : p.id } });
              await refresh();
            }),
            act(isClosing ? 'Remove as closing photo' : 'Use as closing photo', async () => {
              await api('/closing', { method: 'PUT', body: { photoId: isClosing ? null : p.id } });
              await refresh();
            }),
          ]),
          act('↑', () => move(i, -1)),
          act('↓', () => move(i, 1)),
          act('Delete', async () => {
            if (!(await confirmDelete(isVideo ? 'Remove this video from the gallery?' : 'Delete this photo from the gallery?'))) return;
            await api(`/photos/${p.id}`, { method: 'DELETE' });
            await refresh();
          }, 'danger')
        )
      );
      const thumb = isVideo ? `https://i.ytimg.com/vi/${p.youtubeId}/hqdefault.jpg` : p.url;
      const grip = el('div', { className: 'grip', textContent: '⠿ Drag to reorder', title: 'Drag to change the order' });
      const card = el('li', {
        ondragstart: (e) => { dragFrom = i; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.setDragImage(card, 20, 20); startAutoScroll(); },
        ondragend: () => { stopAutoScroll(); card.draggable = false; card.classList.remove('dragging'); clearDropMarks(); dragFrom = -1; },
        ondragover: (e) => {
          if (dragFrom < 0) return;
          e.preventDefault();
          const after = e.clientX > card.getBoundingClientRect().left + card.offsetWidth / 2;
          clearDropMarks();
          card.classList.add(after ? 'drop-after' : 'drop-before');
        },
        ondragleave: (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop-before', 'drop-after'); },
        ondrop: (e) => {
          e.preventDefault();
          const after = card.classList.contains('drop-after');
          clearDropMarks();
          dropPhoto(after ? i + 1 : i);
        },
      },
        grip,
        el('img', { src: thumb, alt: '', loading: 'lazy', className: isVideo ? 'vid' : '' }),
        isVideo ? el('span', { className: 'flag', textContent: '▶ YouTube video' }) : '',
        isPortrait ? el('span', { className: 'flag', textContent: '★ Avatar' }) : '',
        isClosing ? el('span', { className: 'flag', textContent: '♡ Closing photo' }) : '',
        body);
      // Only the grip starts a drag, so selecting text in the caption boxes still works.
      grip.addEventListener('pointerdown', () => (card.draggable = true));
      grip.addEventListener('pointerup', () => (card.draggable = false));
      return card;
    })
  );
}

// ---- comments --------------------------------------------------------------

const UNPUBLISH_WORDS = { title: 'Unpublish this comment?', warning: 'Visitors will no longer see it, and its photo (if any) is hidden too.', yes: 'Yes, unpublish' };
const EDIT_WORDS = { title: 'Edit this comment?', warning: 'The original text is not kept and cannot be restored.', yes: 'Yes, save the edit' };
let commentEditingId = null; // comment being edited in the list, or null
function renderComments() {
  const pending = data.comments.filter((c) => c.status === 'pending').length;
  $('pending-badge').hidden = !pending;
  $('pending-badge').textContent = pending;
  if (!data.comments.length) return $('comments').replaceChildren(el('li', { textContent: 'No comments yet.' }));
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('comments').replaceChildren(
    ...data.comments.map((c) => {
      const act = (text, fn, cls = '') => el('button', { type: 'button', textContent: text, className: cls, onclick: fn });
      const toggle = c.status === 'pending'
        ? act('Approve', async () => { await api(`/comments/${c.id}`, { method: 'PATCH', body: { status: 'approved' } }); await refresh(); }, 'primary')
        : act('Unpublish', async () => { if (!(await confirmTwice('This comment will disappear from the site until you approve it again.', UNPUBLISH_WORDS))) return; await api(`/comments/${c.id}`, { method: 'PATCH', body: { status: 'pending' } }); await refresh(); });
      const editing = commentEditingId === c.id;
      const nameIn = el('input', { value: c.name, maxLength: 40 });
      const msgIn = el('textarea', { rows: 5, maxLength: 2000, value: c.message });
      const emsg = el('span', { className: 'msg', role: 'status' });
      const saveEdit = act('Save', async () => {
        if (nameIn.value.trim() === c.name && msgIn.value.trim() === c.message) { commentEditingId = null; return renderComments(); } // nothing changed
        if (!(await confirmTwice('You are changing what a visitor wrote. The site will show “(edited <date>)” next to it.', EDIT_WORDS))) return;
        try {
          await api(`/comments/${c.id}`, { method: 'PATCH', body: { name: nameIn.value, message: msgIn.value } });
          commentEditingId = null;
          await refresh();
        } catch (err) {
          emsg.className = 'msg error';
          emsg.textContent = err.message === 'name_and_message_required' ? 'Name and message can’t be empty.' : `Failed: ${err.message}`;
        }
      }, 'primary');
      const edited = c.editedAt ? ` · (edited ${fmt.format(new Date(c.editedAt))})` : '';
      return el('li', { className: c.status },
        el('div', { className: 'meta', textContent: `${c.name} · ${fmt.format(new Date(c.createdAt))}${edited} · ${c.status}` }),
        editing ? el('div', {},
          el('label', {}, 'Name', nameIn), el('label', {}, 'Message (the site will show “edited” next to the date)', msgIn),
          el('div', { className: 'row' }, saveEdit, act('Cancel', () => { commentEditingId = null; renderComments(); }, 'ghost'), emsg))
        : el('p', { textContent: c.message }),
        c.photoUrl ? el('a', { href: c.photoUrl, target: '_blank' }, el('img', { className: 'thumb', src: c.photoUrl, alt: 'Guest photo', loading: 'lazy' })) : '',
        el('div', { className: 'acts' }, toggle,
          editing ? '' : act('Edit', () => { commentEditingId = c.id; renderComments(); }),
          c.photoUrl ? act('Remove photo', async () => {
            if (!(await confirmDelete('Remove only the photo and keep the comment?'))) return;
            await api(`/comments/${c.id}/photo`, { method: 'DELETE' });
            await refresh();
          }) : '',
          act('Delete', async () => {
            if (!(await confirmDelete('Delete this comment?'))) return;
            await api(`/comments/${c.id}`, { method: 'DELETE' });
            await refresh();
          }, 'danger'))
      );
    })
  );
}

// ---- content ---------------------------------------------------------------

$('content-lang').replaceChildren(...LANGS.map(([v, t]) => el('option', { value: v, textContent: t })));
// Switching language reloads the form, so warn first if something was edited and not saved.
let shownLang = $('content-lang').value;
let contentSnap = '';
const contentState = () => JSON.stringify([$('c-memory').value, $('c-name').value, $('c-story').value, $('c-loved').value, $('c-tribute').value, tlRows]);
$('content-lang').addEventListener('change', () => {
  if (contentState() !== contentSnap && !confirm('You have unsaved changes. If you switch language they will be discarded. Switch anyway?')) {
    $('content-lang').value = shownLang;
    return;
  }
  loadContentForm();
});

const defaults = {};
async function localeDefaults(lang) {
  if (!defaults[lang]) {
    try {
      const json = await fetch(`/locales/${lang}.json`).then((r) => r.json());
      defaults[lang] = { ...json.content, name: json.name, memory: json['hero.memory'] };
    } catch {
      defaults[lang] = {};
    }
  }
  return defaults[lang];
}

// Show what visitors currently see: the saved text, or the built-in default
// for any field that has no saved text.
async function loadContentForm() {
  const lang = $('content-lang').value;
  const def = await localeDefaults(lang);
  if (lang !== $('content-lang').value) return; // switched while loading
  const saved = data.content[lang] ?? {};
  const cur = (f) => (saved[f]?.length ? saved[f] : def[f] ?? (f === 'tribute' ? '' : []));
  $('c-memory').value = saved.memory || def.memory || '';
  $('c-name').value = saved.name || def.name || '';
  $('c-story').value = cur('story').join('\n\n');
  $('c-loved').value = cur('loved').join('\n');
  tlRows = cur('timeline').map(normalizeEntry) // splits a date typed into the year, or a year typed at the start of the text;
  renderTimelineEditor();
  $('c-tribute').value = cur('tribute');
  shownLang = lang;
  contentSnap = contentState();
  say('content-msg', '');
}

// ---- timeline editor: one row per entry (year = title, optional month and day = subtitle, text) ----
const TIMELINE_MAX = 50;
let tlRows = [];

// Show or clear the red message under Year / Month / Day for one row (without redrawing, so typing keeps focus).
function showTlErrors(node, row) {
  const err = validateEntry(row);
  for (const f of ['year', 'month', 'day']) {
    const field = node.querySelector(`[data-f="${f}"]`);
    field.classList.toggle('invalid', Boolean(err[f]));
    field.querySelector('input').ariaInvalid = err[f] ? 'true' : 'false';
    field.querySelector('.tl-err').textContent = err[f] ?? '';
  }
  return err;
}

function renderTimelineEditor() {
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= tlRows.length) return; [tlRows[i], tlRows[j]] = [tlRows[j], tlRows[i]]; renderTimelineEditor(); };
  const field = (f, label, row, node, props) => {
    const wrap = el('label', {}, label, el('input', { value: row[f], inputMode: 'numeric', autocomplete: 'off', ...props, oninput: (e) => { row[f] = e.target.value; showTlErrors(node(), row); } }), el('span', { className: 'tl-err' }));
    wrap.dataset.f = f;
    return wrap;
  };
  $('c-timeline-list').replaceChildren(
    ...tlRows.map((row, i) => {
      let rowEl;
      const node = () => rowEl;
      rowEl = el('div', { className: 'tl-row' },
        field('year', 'Year', row, node, { maxLength: 4, placeholder: '2011' }),
        field('month', 'Month (optional)', row, node, { maxLength: 2, placeholder: '8' }),
        field('day', 'Day (optional)', row, node, { maxLength: 2, placeholder: '20' }),
        el('div', { className: 'tl-acts' },
          el('button', { type: 'button', className: 'ghost', textContent: '↑', title: 'Move up', ariaLabel: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }),
          el('button', { type: 'button', className: 'ghost', textContent: '↓', title: 'Move down', ariaLabel: 'Move down', disabled: i === tlRows.length - 1, onclick: () => move(i, 1) }),
          el('button', { type: 'button', className: 'danger ghost', textContent: 'Delete', onclick: () => { tlRows.splice(i, 1); renderTimelineEditor(); } })
        ),
        el('label', { className: 'tl-text' }, 'Text', el('textarea', { rows: 2, maxLength: 500, value: row.text, oninput: (e) => (row.text = e.target.value) }))
      );
      // Entries that came from older data and don't fit are flagged straight away; a fresh empty row stays quiet.
      if (row.year || row.month || row.day || row.text) showTlErrors(rowEl, row);
      return rowEl;
    })
  );
  $('tl-add').disabled = tlRows.length >= TIMELINE_MAX;
}

$('tl-add').addEventListener('click', () => {
  tlRows.push({ year: '', month: '', day: '', text: '' });
  renderTimelineEditor();
  $('c-timeline-list').lastElementChild.querySelector('input').focus();
});
$('tl-sort').addEventListener('click', () => {
  const n = (v) => (/^\d+$/.test(v) ? Number(v) : Infinity);
  tlRows = tlRows.map((r, i) => ({ r, i })).sort((a, b) => n(a.r.year) - n(b.r.year) || (Number(a.r.month) || 0) - (Number(b.r.month) || 0) || (Number(a.r.day) || 0) - (Number(b.r.day) || 0) || a.i - b.i).map(({ r }) => r);
  renderTimelineEditor();
});

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

async function saveContent(payload) {
  const lang = $('content-lang').value;
  try {
    data.content[lang] = await api(`/content/${lang}`, { method: 'PUT', body: payload });
    await loadContentForm();
    say('content-msg', 'Saved.');
  } catch (err) {
    say('content-msg', `Failed: ${err.message}`, true);
  }
}

$('content-save').addEventListener('click', () => {
  // Rows without text are dropped on save, so only the rows that will be saved must be valid.
  const kept = tlRows.filter((r) => r.text.trim());
  const bad = kept.findIndex((r) => Object.keys(validateEntry(r)).length);
  if (bad >= 0) {
    const rowEl = $('c-timeline-list').children[tlRows.indexOf(kept[bad])];
    rowEl.querySelector('.invalid input')?.focus();
    rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return say('content-msg', 'Not saved: fix the Year, Month or Day marked in red in the timeline.', true);
  }
  saveContent({
    memory: $('c-memory').value.trim(),
    name: $('c-name').value.trim(),
    story: $('c-story').value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    loved: lines($('c-loved').value),
    timeline: kept.map(toStored),
    tribute: $('c-tribute').value.trim(),
  });
});
$('content-reset').addEventListener('click', () => {
  if (confirm('Discard your saved text for this language and go back to the built-in defaults?')) saveContent({});
});

boot();


// ---- themes ----------------------------------------------------------------

const COLORS = [
  ['bg', '--bg', 'Background'],
  ['bg2', '--bg-2', 'Alternate section background'],
  ['ink', '--ink', 'Text'],
  ['muted', '--muted', 'Muted text'],
  ['accent', '--accent', 'Accent'],
  ['gold', '--gold', 'Secondary accent'],
  ['card', '--card', 'Cards & inputs'],
  ['line', '--line', 'Lines & borders'],
];
let themeDefaults = null; // read from theme.css via off-screen probes, so there is one source of truth
let editingId = null;     // custom theme currently open in the editor
let draft = null;         // { name, light: {...}, dark: {...} } (overrides only)

function readDefaults() {
  const out = {};
  for (const mode of ['light', 'dark']) {
    const probe = el('div', { hidden: true });
    probe.dataset.theme = mode;
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    out[mode] = Object.fromEntries(COLORS.map(([k, v]) => [k, cs.getPropertyValue(v).trim().toLowerCase()]));
    probe.remove();
  }
  return out;
}

const palette = (theme, mode) => ({ ...themeDefaults[mode], ...(theme[mode] ?? {}) });

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Only keep colours that differ from the built-in defaults.
const diff = (overrides, mode) =>
  Object.fromEntries(Object.entries(overrides[mode] ?? {}).filter(([k, v]) => v && v !== themeDefaults[mode][k]));

const customThemes = () => data.themes?.custom ?? [];

async function themeAction(fn, okMsg) {
  try {
    await fn();
    await refresh();
    await reloadThemeCss();
    if (okMsg) say('theme-msg', okMsg);
  } catch (err) {
    say('theme-msg', `Failed: ${err.message}`, true);
  }
}

function swatch(theme) {
  const half = (mode) => {
    const p = palette(theme, mode);
    return el('span', { className: 'half', style: `background:${p.bg};color:${p.ink}` },
      el('i', { style: `background:${p.accent}` }), el('i', { style: `background:${p.gold}` }), el('i', { style: `background:${p.line}` }));
  };
  return el('span', { className: 'swatch' }, half('light'), half('dark'));
}

function renderThemeForm() {
  themeDefaults ??= readDefaults();
  if (editingId && !customThemes().some((t) => t.id === editingId)) editingId = null;
  const all = [...data.themes.builtin, ...customThemes()];
  const activeId = data.themes.activeId;
  const act = (text, fn, cls = '') => el('button', { type: 'button', textContent: text, className: cls, onclick: fn });

  $('themes').replaceChildren(
    ...all.map((t) => {
      const builtin = data.themes.builtin.some((b) => b.id === t.id);
      const active = t.id === activeId;
      return el('li', { className: `tcard${active ? ' active' : ''}${editingId === t.id ? ' editing' : ''}` },
        swatch(t),
        el('div', { className: 'tname' }, el('strong', { textContent: t.name }),
          active ? el('span', { className: 'badge ok', textContent: 'Active' }) : '',
          builtin ? el('span', { className: 'tag', textContent: 'built-in' }) : ''),
        el('div', { className: 'acts' },
          active ? '' : act('Apply', () => themeAction(() => api('/themes/active', { method: 'PUT', body: { id: t.id } }), `“${t.name}” is now live.`), 'primary'),
          builtin ? '' : act('Edit', () => { editingId = t.id; draft = null; renderThemeForm(); }),
          act('Duplicate', () => themeAction(async () => {
            const copy = await api('/themes', { method: 'POST', body: { name: `${t.name} copy`, light: t.light, dark: t.dark } });
            editingId = copy.id;
            draft = null;
          }, 'Duplicated. Edit the copy below.')),
          builtin ? '' : act('Delete', async () => {
            if (!confirm(`Delete the theme “${t.name}”?`)) return;
            await themeAction(() => api(`/themes/${t.id}`, { method: 'DELETE' }), 'Theme deleted.');
          }, 'danger')));
    })
  );

  const t = customThemes().find((x) => x.id === editingId);
  if (!t) return $('theme-editor').replaceChildren(el('p', { className: 'hint', textContent: 'Choose Edit on one of your themes to change its colours.' }));
  draft ??= { name: t.name, light: { ...t.light }, dark: { ...t.dark } };
  const name = el('input', { value: draft.name, maxLength: 40, oninput: (e) => (draft.name = e.target.value) });
  $('theme-editor').replaceChildren(
    el('div', { className: 'card' },
      el('label', {}, 'Theme name', name),
      el('p', { className: 'hint', textContent: activeId === t.id ? 'This theme is live. Saving updates the public site.' : 'This theme is not live yet. Press Apply on its card to use it.' }),
      el('div', { className: 'theme-grid' }, modeCard('light'), modeCard('dark')),
      el('div', { className: 'row' }, act('Save theme', () => themeAction(async () => {
        await api(`/themes/${t.id}`, { method: 'PUT', body: { name: draft.name, light: diff(draft, 'light'), dark: diff(draft, 'dark') } });
        draft = null;
      }, 'Theme saved.'), 'primary'), act('Close', () => { editingId = null; draft = null; renderThemeForm(); }, 'ghost')))
  );
}

function modeCard(mode) {
  const value = (k) => draft[mode][k] ?? themeDefaults[mode][k];
  const preview = el('div', { className: 'tpreview' },
    el('strong', { textContent: 'Barry' }),
    el('p', { textContent: 'In loving memory' }),
    el('span', { className: 'pmuted', textContent: 'Muted text' }),
    el('button', { type: 'button', className: 'pbtn', textContent: 'Send' }),
    el('div', { className: 'pcard', textContent: 'A card' }));
  preview.dataset.theme = mode; // base palette for any variable not overridden
  const ratio = el('span', { className: 'ratio' });
  const paint = () => {
    for (const [k, v] of COLORS) preview.style.setProperty(v, value(k));
    const c = contrast(value('ink'), value('bg'));
    ratio.textContent = `Text contrast ${c.toFixed(1)}:1 ${c >= 4.5 ? '✓' : '⚠ low, hard to read'}`;
    ratio.classList.toggle('error', c < 4.5);
  };
  const rows = COLORS.map(([k, , label]) => {
    const input = el('input', { type: 'color', value: value(k), oninput: (e) => { draft[mode][k] = e.target.value.toLowerCase(); paint(); } });
    return el('label', { className: 'crow' }, input, el('span', { textContent: label }));
  });
  const reset = el('button', { type: 'button', className: 'ghost', textContent: 'Reset to default colours', onclick: () => {
    draft[mode] = {};
    rows.forEach((r, i) => (r.querySelector('input').value = themeDefaults[mode][COLORS[i][0]]));
    paint();
  } });
  paint();
  return el('div', { className: 'mode' }, el('h2', { textContent: mode === 'light' ? 'Light mode' : 'Dark mode' }), preview, ratio, ...rows, reset);
}

$('theme-new').addEventListener('click', () =>
  themeAction(async () => {
    const t = await api('/themes', { method: 'POST', body: { name: 'New theme', light: {}, dark: {} } });
    editingId = t.id;
    draft = null;
  }, 'Created. Pick your colours below.')
);


// ---- diary -----------------------------------------------------------------

let diaryEditingId = null; // entry id, 'new', or null
let diaryLang = 'en';

const diaryFilled = (d) => LANGS.filter(([l]) => d.title[l] || d.text[l]).map(([l]) => l);
const todayIso = () => new Date().toISOString().slice(0, 10);

function renderDiaryAdmin() {
  if (diaryEditingId && diaryEditingId !== 'new' && !data.diary.some((d) => d.id === diaryEditingId)) diaryEditingId = null;
  const act = (text, fn, cls = '') => el('button', { type: 'button', textContent: text, className: cls, onclick: fn });
  $('diary-list').replaceChildren(
    ...(data.diary.length ? data.diary.map((d) => {
      const first = LANGS.map(([l]) => d.title[l] || d.text[l]).find(Boolean) ?? '';
      return el('li', {},
        el('div', { className: 'meta', textContent: `${d.date} · ${diaryFilled(d).join(', ') || 'empty'}${d.location ? ` · 📍 ${d.location.name}` : ''}` }),
        el('p', { textContent: first.length > 140 ? `${first.slice(0, 140)}…` : first }),
        d.photoUrl ? el('img', { className: 'thumb', src: d.photoUrl, alt: '', loading: 'lazy' }) : '',
        d.youtubeId ? el('img', { className: 'thumb', src: `https://i.ytimg.com/vi/${d.youtubeId}/hqdefault.jpg`, alt: '', loading: 'lazy' }) : '',
        el('div', { className: 'acts' }, act('Edit', () => openDiaryEditor(d.id))));
    }) : [el('li', { textContent: 'No memories yet. Press “New memory” to write the first one.' })])
  );
  if (!diaryEditingId) $('diary-editor').replaceChildren();
  // One thing at a time: while an entry is open the list is hidden, so there is no second Edit button to confuse.
  for (const id of ['diary-intro', 'diary-count', 'diary-list']) $(id).hidden = Boolean(diaryEditingId);
}

function openDiaryEditor(id) {
  diaryEditingId = id;
  const entry = id === 'new'
    ? { id: null, date: todayIso(), title: {}, text: {}, photoUrl: null, youtubeId: null }
    : structuredClone(data.diary.find((d) => d.id === id));
  const draft = { date: entry.date, title: { ...entry.title }, text: { ...entry.text } };
  let pendingFile = null;
  let mediaMode = entry.youtubeId ? 'video' : 'photo'; // a memory has a photo or a YouTube video
  const youtubeInput = el('input', { type: 'url', placeholder: 'https://www.youtube.com/watch?v=…', maxLength: 300, value: entry.youtubeId ? `https://youtu.be/${entry.youtubeId}` : '' });

  const date = el('input', { type: 'date', value: draft.date, max: todayIso(), oninput: (e) => (draft.date = e.target.value) });
  const tabs = el('div', { className: 'ltabs' });
  const panes = el('div', {});
  const paint = () => {
    tabs.replaceChildren(...LANGS.map(([l, name]) => el('button', {
      type: 'button', className: l === diaryLang ? 'on' : '', textContent: `${name.split('（')[0]}${draft.title[l] || draft.text[l] ? ' •' : ''}`,
      onclick: () => { diaryLang = l; paint(); },
    })));
    panes.replaceChildren(
      el('label', {}, 'Title (optional)', el('input', { value: draft.title[diaryLang] ?? '', maxLength: 120, oninput: (e) => (draft.title[diaryLang] = e.target.value) })),
      el('label', {}, 'Memory (blank line = new paragraph)', el('textarea', { rows: 9, maxLength: 8000, value: draft.text[diaryLang] ?? '', oninput: (e) => (draft.text[diaryLang] = e.target.value) }))
    );
  };

  // Check-in: a place name, optionally pinned on the map by picking a search result.
  const loc = { name: '', address: '', lat: null, lon: null, ...(entry.location ?? {}) };
  const pinNote = el('p', { className: 'hint' });
  const results = el('div', { className: 'places' });
  const paintPin = () => {
    pinNote.textContent = loc.lat != null ? `Pinned on the map${loc.address ? `: ${loc.address}` : '.'}` : loc.name.trim() ? 'Name only, no map pin. Use “Search map” to pin it.' : '';
  };
  const placeName = el('input', {
    value: loc.name, maxLength: 120, placeholder: 'e.g. Daan Forest Park',
    oninput: (e) => { loc.name = e.target.value; paintPin(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlaces(); } },
  });
  async function searchPlaces() {
    const q = placeName.value.trim();
    if (!q) { // no silent clicks: say what to do
      results.replaceChildren(el('p', { className: 'hint', textContent: 'Type a place name first (for example “Daan Forest Park”), then press Search map.' }));
      placeName.focus();
      return;
    }
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';
    results.replaceChildren(el('p', { className: 'hint', textContent: 'Searching…' }));
    try {
      const found = await api(`/places?q=${encodeURIComponent(q)}&lang=${diaryLang}`);
      results.replaceChildren(
        ...(found.length
          ? found.map((p) => el('button', { type: 'button', className: 'place-opt', onclick: () => {
              Object.assign(loc, { name: p.name, address: p.address, lat: p.lat, lon: p.lon });
              placeName.value = p.name;
              results.replaceChildren();
              paintPin();
            } }, el('strong', { textContent: p.name }), el('span', { textContent: p.address })))
          : [el('p', { className: 'hint', textContent: 'No matches. You can still save the name as typed.' })])
      );
    } catch (err) {
      results.replaceChildren(el('p', { className: 'hint', textContent: err.message === 'slow_down' ? 'Please wait a second and try again.' : 'Map search is unavailable right now. You can still type a place name.' }));
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search map';
    }
  }
  const searchBtn = act2('Search map', () => searchPlaces(), 'ghost');
  const clearPlace = () => { Object.assign(loc, { name: '', address: '', lat: null, lon: null }); placeName.value = ''; results.replaceChildren(); paintPin(); };
  paintPin();

  const preview = el('div', { className: 'diary-photo' });
  const paintPhoto = () => preview.replaceChildren(
    ...(pendingFile ? [el('img', { src: URL.createObjectURL(pendingFile), alt: '' }), el('span', { className: 'hint', textContent: 'New photo (saved with the memory)' })]
      : entry.photoUrl ? [el('img', { src: entry.photoUrl, alt: '' })] : [el('span', { className: 'hint', textContent: 'No photo' })])
  );
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: (e) => { pendingFile = e.target.files[0] ?? null; e.target.value = ''; paintPhoto(); } });
  const removePhoto = act2('Remove photo', async () => {
    if (pendingFile) { pendingFile = null; return paintPhoto(); }
    if (!entry.id || !(await confirmDelete('Remove the photo from this memory?'))) return;
    await api(`/diary/${entry.id}/photo`, { method: 'DELETE' });
    entry.photoUrl = null;
    await refresh();
    paintPhoto();
  }, 'ghost');
  function act2(text, fn, cls = '') { return el('button', { type: 'button', textContent: text, className: cls, onclick: fn }); }

  const mediaSelect = el('select', { onchange: (e) => { mediaMode = e.target.value; paintMedia(); } },
    ...[['photo', 'Photo (or none)'], ['video', 'YouTube video']].map(([v, t]) => el('option', { value: v, textContent: t, selected: v === mediaMode })));
  const photoBox = el('div', {}, el('div', { className: 'row' }, el('label', { className: 'filebtn' }, 'Add / replace photo', fileInput), removePhoto), preview);
  const videoBox = el('div', {}, el('label', {}, 'YouTube link', youtubeInput),
    el('p', { className: 'hint', textContent: 'Choosing a video replaces the memory’s photo (when you save). Visitors see the video thumbnail and play it in the memory pop-up.' }));
  const paintMedia = () => { photoBox.hidden = mediaMode !== 'photo'; videoBox.hidden = mediaMode !== 'video'; };
  paintMedia();

  const msg = el('span', { className: 'msg', role: 'status' });
  const save = act2('Save memory', async () => {
    try {
      msg.className = 'msg';
      msg.textContent = 'Saving…';
      const body = { date: draft.date, title: draft.title, text: draft.text, location: loc.name.trim() ? { ...loc, name: loc.name.trim() } : null, youtube: mediaMode === 'video' ? youtubeInput.value.trim() : '' };
      if (mediaMode === 'video' && !body.youtube) throw new Error('missing_youtube_url');
      const saved = entry.id ? await api(`/diary/${entry.id}`, { method: 'PUT', body }) : await api('/diary', { method: 'POST', body });
      if (mediaMode === 'photo' && pendingFile) {
        await withBusy('Uploading photo', (show) =>
          prepareAndSend([pendingFile], 2000, (files) => { const form = new FormData(); form.append('photo', files[0]); return form; }, (form, onProgress) => apiUpload(`/diary/${saved.id}/photo`, form, onProgress), show)
        );
      }
      diaryEditingId = null;
      await refresh();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = err.message === 'invalid_date' ? 'Please pick a valid date.'
        : err.message === 'invalid_youtube_url' || err.message === 'missing_youtube_url' ? 'That doesn’t look like a YouTube link.'
        : err.message === 'too_many_entries' ? `The diary is full (${data.limits.diary.max} memories). Delete an old memory first.`
        : `Failed: ${err.message}`;
    }
  }, 'primary');
  const del = entry.id ? act2('Delete memory', async () => {
    if (!(await confirmDelete('Delete this diary memory?'))) return;
    await api(`/diary/${entry.id}`, { method: 'DELETE' });
    diaryEditingId = null;
    await refresh();
  }, 'danger') : '';
  const close = act2('Cancel', () => { diaryEditingId = null; renderDiaryAdmin(); }, 'ghost');

  paint();
  paintPhoto();
  $('diary-editor').replaceChildren(el('div', { className: 'card' },
    el('h2', { className: 'editor-title', textContent: entry.id ? `Editing the memory of ${entry.date}` : 'New memory' }),
    el('label', {}, 'Date of the memory', date),
    el('label', {}, 'Location (check-in, optional)',
      el('div', { className: 'row place-row' }, placeName, searchBtn, act2('Clear', clearPlace, 'ghost'))),
    pinNote, results,
    tabs, panes,
    el('label', {}, 'Photo or video', mediaSelect),
    photoBox, videoBox,
    el('div', { className: 'row' }, save, close, del, msg)));
  renderDiaryAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('diary-new').addEventListener('click', () => openDiaryEditor('new'));


// ---- admin follows the live site theme ---------------------------------------

let themeLink = document.getElementById('theme-css');

// If the live theme would make the admin unreadable (text vs background), ignore it for the admin only.
function guardContrast() {
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim();
  const bg = cs.getPropertyValue('--bg').trim();
  const bad = /^#[0-9a-f]{6}$/i.test(ink) && /^#[0-9a-f]{6}$/i.test(bg) && contrast(ink, bg) < 3;
  themeLink.disabled = bad;
  $('theme-banner').hidden = !bad;
}

// Re-fetch the stylesheet after the theme changes, without a page reload. The new link is inserted next to
// the old one and the old one is removed only once the new one has loaded (no flash, no re-load).
function reloadThemeCss() {
  return new Promise((resolve) => {
    const next = el('link', { rel: 'stylesheet', href: `/theme-overrides.css?v=${Date.now()}` });
    const done = () => {
      themeLink.remove();
      next.id = 'theme-css';
      themeLink = next;
      guardContrast();
      resolve();
    };
    next.onload = next.onerror = done;
    themeLink.after(next);
  });
}

themeLink.addEventListener('load', guardContrast);
guardContrast();


// ---- icons -------------------------------------------------------------------

const ICON_SLOTS = [
  ['brand', 'Top-left icon', 'Next to “Barry” in the top bar.'],
  ['badge', 'Avatar badge', 'The small round badge on Barry’s portrait.'],
];

function renderIconSlots() {
  $('icon-slots').replaceChildren(...ICON_SLOTS.map(([slot, title, hint]) => {
    const current = data.icons?.[slot] ?? null;
    const set = (body) => iconAction(() => api(`/icons/${slot}`, { method: 'PUT', body }), slot);
    const preview = el('span', { className: `icon-preview ${slot === 'badge' ? 'on-accent' : ''}` }, iconNode(current, slot));
    // The selected button is the current icon, or the slot's built-in default when nothing is configured.
    const isOn = (type, value) => {
      const c = current ?? DEFAULT_ICON[slot];
      return c.type === type && c.value === value;
    };
    const presets = [
      // The 🐾 emoji (two paw prints). For the top-left slot it IS the default, so this button resets to it.
      el('button', {
        type: 'button', title: 'Paw prints 🐾', className: isOn('emoji', '🐾') ? 'on' : '',
        onclick: () => set(slot === 'brand' ? { type: 'default' } : { type: 'emoji', value: '🐾' }),
      }, iconNode({ type: 'emoji', value: '🐾' })),
      ...PRESET_IDS.map((id) => el('button', {
        type: 'button', title: id, className: isOn('preset', id) ? 'on' : '',
        onclick: () => set({ type: 'preset', value: id }),
      }, iconNode({ type: 'preset', value: id }))),
    ];
    const emoji = el('input', { value: current?.type === 'emoji' ? current.value : '', maxLength: 8, placeholder: '🐶', 'aria-label': 'Emoji' });
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      // Sent as-is: the client-side shrink flattens transparency onto white. The server resizes to 256 px and keeps alpha.
      const form = new FormData();
      form.append('icon', f);
      iconAction(() => api(`/icons/${slot}/image`, { method: 'POST', form }), slot);
    } });
    return el('div', { className: 'card' },
      el('div', { className: 'row' }, preview, el('div', {}, el('strong', { textContent: title }), el('p', { className: 'hint', textContent: hint }))),
      el('div', { className: 'presets' }, ...presets),
      el('div', { className: 'row' }, emoji, el('button', { type: 'button', textContent: 'Use emoji', onclick: () => set({ type: 'emoji', value: emoji.value }) })),
      el('div', { className: 'row' },
        el('label', { className: 'filebtn' }, 'Upload picture', file),
        el('button', { type: 'button', className: 'ghost', textContent: slot === 'brand' ? 'Reset to default (🐾)' : 'Reset to default (paw)', onclick: () => set({ type: 'default' }) }),
        el('span', { className: 'msg', id: `icon-msg-${slot}`, role: 'status' })));
  }));
}

async function iconAction(fn, slot) {
  try {
    data.icons = await fn();
    renderIconSlots();
    say(`icon-msg-${slot}`, 'Saved.');
  } catch (err) {
    say(`icon-msg-${slot}`, err.message === 'invalid_icon' ? 'Please type a single emoji.' : `Failed: ${err.message}`, true);
  }
}


// ---- change password ---------------------------------------------------------

const pwDialog = $('pw-dialog');
const pwForm = $('pw-form');

$('pw-open').addEventListener('click', () => {
  pwForm.reset();
  say('pw-msg', '');
  $('pw-hint').textContent = data.account?.passwordChangedAt
    ? `Last changed ${new Date(data.account.passwordChangedAt).toLocaleString()}.`
    : 'You are still using the initial password from the server settings. Choose your own.';
  pwDialog.showModal();
});
$('pw-cancel').addEventListener('click', () => pwDialog.close());
pwDialog.addEventListener('click', (e) => { if (e.target === pwDialog) pwDialog.close(); });

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(pwForm);
  const [current, next, again] = [f.get('current'), f.get('next'), f.get('again')];
  if (next !== again) return say('pw-msg', 'The two new passwords don’t match.', true);
  if (next.length < 10) return say('pw-msg', 'Use at least 10 characters.', true);
  const btn = pwForm.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('/password', { method: 'POST', body: { current, next } });
    data.account = { passwordChangedAt: new Date().toISOString() };
    pwForm.reset();
    say('pw-msg', 'Password changed. Other sessions were signed out.');
    setTimeout(() => pwDialog.close(), 1500);
  } catch (err) {
    say('pw-msg', {
      wrong_current_password: 'The current password is wrong.',
      password_too_short: 'Use at least 10 characters.',
      password_unchanged: 'The new password must be different from the current one.',
      too_many_requests: 'Too many attempts. Please wait a few minutes.',
    }[err.message] ?? `Failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
});
