const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

// Session lifetime is echoed to the client via /api/login response.
const SESSION_MS = 30 * 60 * 1000;

// "Lifetime" sessions, requested by edit-mode clients. Ten years rather than
// Infinity so the value stays a real number everywhere it is compared.
const PERSIST_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// Resolve the DB path. Default lives under ./data so it's easy to gitignore.
// On Render, mount a Persistent Disk at /var/data and set DB_PATH=/var/data/app.db.
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');

// The database is opened lazily, on first use.
//
// `next build` imports every route module in several parallel workers to
// collect page data. If opening the database happened at import time, each
// worker would race to create the file, switch it to WAL (which needs an
// exclusive lock) and write the seed rows — which fails the build with
// SQLITE_BUSY. Nothing here runs until a request actually asks for a setting.
let db = null;
let getStmt = null;
let setStmt = null;

const getSetting = (key) => {
  init();
  return getStmt.get(key)?.value ?? null;
};

const setSetting = (key, value) => {
  init();
  return setStmt.run(key, String(value));
};

function init() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const handle = new Database(DB_PATH);
  // Wait for a competing writer rather than failing instantly. Set before the
  // journal_mode switch, which is itself a locking operation.
  handle.pragma('busy_timeout = 5000');
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  handle.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  getStmt = handle.prepare('SELECT value FROM settings WHERE key = ?');
  setStmt = handle.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  // Assign before seeding: seed() goes through getSetting/setSetting, which
  // call init() again and must short-circuit here.
  db = handle;
  seed();
  return db;
}

function seed() {
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
    let value = process.env.INITIAL_PASSWORD || '';
    if (!value) {
      try {
        const legacy = path.join(process.cwd(), 'app', 'database', 'db.json');
        if (fs.existsSync(legacy)) {
          const raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
          if (typeof raw?.pwd === 'string' && raw.pwd) value = raw.pwd;
        }
      } catch {
        // ignore — fall through to default
      }
    }
    setSetting('pwd', value || 'change-me');
  }
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

// Token format: "<issuedAt>.<ttl>.<hex-hmac>". The signature covers both the
// timestamp and the lifetime, so a client cannot extend its own session by
// editing either one.
//
// Two-part tokens ("<issuedAt>.<hex-hmac>") are the older format and are still
// accepted at the default lifetime, so an existing session is not invalidated
// by this change.
const signToken = (issuedAt = Date.now(), ttl = SESSION_MS) => {
  const payload = `${issuedAt}.${ttl}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, expiresAt: issuedAt + ttl };
};

const verifyToken = (token) => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');

  let payload;
  let sig;
  let issuedAt;
  let ttl;

  if (parts.length === 3) {
    [, , sig] = parts;
    payload = `${parts[0]}.${parts[1]}`;
    issuedAt = Number(parts[0]);
    ttl = Number(parts[1]);
  } else if (parts.length === 2) {
    [, sig] = parts;
    payload = parts[0];
    issuedAt = Number(parts[0]);
    ttl = SESSION_MS;
  } else {
    return null;
  }

  if (!sig || !Number.isFinite(issuedAt) || !Number.isFinite(ttl) || ttl <= 0) {
    return null;
  }

  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;
  if (Date.now() - issuedAt > ttl) return null;
  return { issuedAt, expiresAt: issuedAt + ttl };
};

// Where uploads land in Drive. Normally GOOGLE_DRIVE_FOLDER_ID, but if that
// folder is unreachable under the drive.file scope the app creates its own and
// remembers the id here.
const getDriveFolder = () => getSetting('drive_folder_id');
const setDriveFolder = (id) => setSetting('drive_folder_id', id);

module.exports = {
  SESSION_MS,
  PERSIST_MS,
  getDriveFolder,
  setDriveFolder,
  getPassword,
  setPassword,
  signToken,
  verifyToken,
};
