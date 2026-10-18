import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = () => ({ settings: { avatar: null }, content: {}, photos: [], comments: [], diary: [] });

// Single-file JSON store. Writes are serialized and atomic (temp file + rename).
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.uploads = path.join(dir, 'uploads');
    this.queue = Promise.resolve();
    this.db = EMPTY();
  }

  async init() {
    await fs.mkdir(this.uploads, { recursive: true });
    try {
      this.db = { ...EMPTY(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  // Run fn(db) exclusively, then persist. fn should validate before mutating.
  update(fn) {
    const run = this.queue.then(async () => {
      const result = await fn(this.db);
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.db, null, 2));
      await fs.rename(tmp, this.file);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
