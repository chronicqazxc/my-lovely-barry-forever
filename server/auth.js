import crypto from 'node:crypto';

const COOKIE = 'barry_admin';
const TTL_MS = 1000 * 60 * 60 * 12;

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

// Stored as "scrypt$<salt hex>$<key hex>". The plain password is never stored.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
}

async function verifyHash(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// `password` is the initial password from the environment. Once the owner sets one in the admin, `getAdmin()`
// returns { hash, version } and the environment password is ignored. `version` goes into every session
// token, so changing the password signs out every other session.
export function createAuth({ password, secret, getAdmin = () => undefined }) {
  const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('hex');
  const safeEq = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  const version = () => String(getAdmin()?.version ?? 0);

  const readCookie = (req) =>
    (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .find(([k]) => k === COOKIE)?.[1];

  const isAuthed = (req) => {
    const token = readCookie(req);
    if (!token) return false;
    const [exp, ver, sig] = token.split('.');
    return Boolean(sig) && Number(exp) > Date.now() && ver === version() && safeEq(sig, sign(`${exp}.${ver}`));
  };

  return {
    async checkPassword(input) {
      const given = typeof input === 'string' ? input : '';
      const admin = getAdmin();
      return admin?.hash ? verifyHash(given, admin.hash) : safeEq(given, password);
    },
    login(req, res) {
      const exp = String(Date.now() + TTL_MS);
      const ver = version();
      const secure = req.secure ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${exp}.${ver}.${sign(`${exp}.${ver}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}${secure}`
      );
    },
    logout(res) {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    },
    isAuthed,
    require(req, res, next) {
      if (isAuthed(req)) return next();
      res.status(401).json({ error: 'unauthorized' });
    },
  };
}
