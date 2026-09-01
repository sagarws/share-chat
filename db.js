const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

// Session lifetime is echoed to the client via /api/login response.
const SESSION_MS = 30 * 60 * 1000;

// Resolve the DB path. Default lives under ./data so it's easy to gitignore.
// On Render, mount a Persistent Disk at /var/data and set DB_PATH=/var/data/app.db.
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const getSetting = (key) => getStmt.get(key)?.value ?? null;
const setSetting = (key, value) => setStmt.run(key, String(value));

// Seed a random HMAC secret on first boot. If it disappears (e.g. a wiped
// disk), all outstanding tokens become invalid — that's fine, users just
// re-login.
// Prefer AUTH_SECRET from the environment. On a host with no persistent disk
// (Render's free plan wipes ./data on every redeploy) a generated secret would
// change each deploy, invalidating everyone's session. An env-provided secret
// keeps sessions alive across deploys.
if (process.env.AUTH_SECRET) {
  if (getSetting('auth_secret') !== process.env.AUTH_SECRET) {
    setSetting('auth_secret', process.env.AUTH_SECRET);
  }
} else if (!getSetting('auth_secret')) {
  setSetting('auth_secret', crypto.randomBytes(32).toString('hex'));
}

// Seed the password. Prefer env → legacy db.json (one-shot migration) →
// hardcoded fallback so a fresh boot on Render still logs in with something.
if (!getSetting('pwd')) {
  let seed = process.env.INITIAL_PASSWORD || '';
  if (!seed) {
    try {
      const legacy = path.join(process.cwd(), 'app', 'database', 'db.json');
      if (fs.existsSync(legacy)) {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
        if (typeof raw?.pwd === 'string' && raw.pwd) seed = raw.pwd;
      }
    } catch {
      // ignore — fall through to default
    }
  }
  setSetting('pwd', seed || 'change-me');
}

const getPassword = () => getSetting('pwd');
const setPassword = (pwd) => setSetting('pwd', pwd);
const getSecret = () => getSetting('auth_secret');

// Constant-time comparison to avoid leaking hash bytes via timing.
const safeEqual = (a, b) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

// Token format: "<issuedAt>.<hex-hmac>". The signature covers the timestamp,
// so tampering with the timestamp invalidates the token.
const signToken = (issuedAt = Date.now()) => {
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(String(issuedAt))
    .digest('hex');
  return { token: `${issuedAt}.${sig}`, expiresAt: issuedAt + SESSION_MS };
};

const verifyToken = (token) => {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const dot = token.indexOf('.');
  const issuedAt = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(issuedAt) || !sig) return null;

  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(String(issuedAt))
    .digest('hex');
  if (!safeEqual(sig, expected)) return null;
  if (Date.now() - issuedAt > SESSION_MS) return null;
  return { issuedAt, expiresAt: issuedAt + SESSION_MS };
};

// Where uploads land in Drive. Normally GOOGLE_DRIVE_FOLDER_ID, but if that
// folder is unreachable under the drive.file scope the app creates its own and
// remembers the id here.
const getDriveFolder = () => getSetting('drive_folder_id');
const setDriveFolder = (id) => setSetting('drive_folder_id', id);

module.exports = {
  SESSION_MS,
  getDriveFolder,
  setDriveFolder,
  getPassword,
  setPassword,
  signToken,
  verifyToken,
};
