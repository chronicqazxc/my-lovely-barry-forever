# Barry, Forever

Memorial site for Barry, a female Jack Russell Terrier (2011-08-20 – 2026-10-04).

Live site: https://barry.waynehsiao.app

This repository holds the code only. Barry's photos, memories and visitor messages are stored on the server and are not in git. You can reuse the code for a memorial site of your own.

- **Languages:** English, 繁體中文 (zh-TW), 日本語, 한국어. Auto-detected, switchable, remembered.
- **Theme:** light / dark, follows the OS until the visitor picks one.
- **Admin (`/admin/`):** upload a dedicated avatar and closing photo (or use gallery photos), add photos or YouTube links to the gallery, caption/reorder/delete them, approve or delete visitor comments and their photos, write diary memories (with optional photos), edit story/timeline/quotes per language, choose the top-left icon and avatar badge (preset, emoji or picture), manage themes (built-in presets plus your own light/dark colour sets; the admin takes on the live theme's colours).
- Visitors can leave a comment with **one optional photo**. Both stay **pending** until approved in the admin; approved messages and photos appear together in the "Messages from Friends & Family" section (messages are shown in full; the length limit is 500 characters, change it with `COMMENT_MAX_CHARS`).

## Layout

```
public/            static front end (no build step)
  index.html  js/{app,i18n,theme}.js  css/  locales/{en,ja,ko,zh-TW}.json
  admin/           admin UI
server/            Express API + static hosting (store.js = JSON file DB)
data/              runtime data: db.json + uploads/ (gitignored, back this up)
```

## Run locally

```bash
npm install
ADMIN_PASSWORD=choose-one npm run dev     # http://localhost:3000  and  /admin/
```

## Limits (storage budget)

- Gallery: **50 photos** (YouTube links don't count). Comments (Messages from Friends & Family): **100 stored** (pending + approved); when full the form is replaced by a friendly notice until you delete some in the admin. Diary: **100 entries**. Also: 30 unreviewed guest photos at once, 20 custom themes.
- Change them with `GALLERY_PHOTO_LIMIT`, `COMMENT_LIMIT` and `DIARY_ENTRY_LIMIT` in `.env`. The admin shows current usage.

## Images

Every uploaded image (admin or visitor) is processed on the server: auto-rotated, scaled down (gallery 2000 px, guest photos 1600 px, avatar/closing photo 1200 px on the longest side), converted to WebP and stripped of EXIF metadata such as GPS location. Originals are not kept. Animated GIFs stay animated (max 100 frames). JPG, PNG, WebP and GIF are accepted; HEIC is not.

## Editing text

- UI strings and default story/timeline text live in `public/locales/*.json`.
- Anything saved in the admin **Content** tab overrides those defaults for that language.
- To add a language: add `locales/<code>.json`, add it to `LANGS` in `public/js/i18n.js`, `public/admin/admin.js`, and `server/index.js`.

## Deploy

Barry runs on its own Google Cloud VM. Everything (VM setup, deploy script, nightly backups, restore, cost) is in [deploy/README.md](deploy/README.md).
Quick local try of the production stack (app + Caddy): `cp .env.example .env` (set `DOMAIN=localhost`), then `docker compose up --build`.

Your data (`db.json` + `uploads/`) is the only thing worth backing up; the nightly backup and restore steps are in [deploy/README.md](deploy/README.md).

## License

The code is released under the [MIT License](LICENSE). The license covers the code only. Barry's photos and the texts written for her stay with the owner and are not part of this repository.
