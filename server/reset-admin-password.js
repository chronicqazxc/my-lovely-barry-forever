// Emergency recovery if the admin password is forgotten: removes the password set in the admin, so the initial
// ADMIN_PASSWORD from .env works again, and signs out every session. Then restart the app.
//   on the VM:  sudo docker exec barry-barry-1 node server/reset-admin-password.js && sudo docker compose restart barry
//   locally:    DATA_DIR=./data node server/reset-admin-password.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(path.resolve(root, process.env.DATA_DIR || 'data'), 'db.json');

const db = JSON.parse(fs.readFileSync(file, 'utf8'));
db.settings ??= {};
db.settings.admin = { version: (db.settings.admin?.version ?? 0) + 1 }; // no hash: the .env password applies again
fs.writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2));
fs.renameSync(`${file}.tmp`, file);
console.log('Admin password reset: the ADMIN_PASSWORD from .env works again. Restart the app now.');
