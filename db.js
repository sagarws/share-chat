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
let listFoldersStmt = null;
let getFolderStmt = null;
let addFolderStmt = null;
let deleteFolderStmt = null;
let acct = null; // prepared statements for connected Google accounts

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
    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- Users who connected their own Google Drive on the /drive page.
    CREATE TABLE IF NOT EXISTS google_accounts (
      id             TEXT PRIMARY KEY,
      sub            TEXT NOT NULL UNIQUE,
      email          TEXT NOT NULL DEFAULT '',
      name           TEXT NOT NULL DEFAULT '',
      picture        TEXT NOT NULL DEFAULT '',
      refresh_token  TEXT NOT NULL,
      root_folder_id TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
    -- Root folders of a connected account, the per-user twin of "folders".
    CREATE TABLE IF NOT EXISTS account_folders (
      account_id TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, id)
    );
  `);

  acct = {
    get: handle.prepare('SELECT * FROM google_accounts WHERE id = ?'),
    bySub: handle.prepare('SELECT * FROM google_accounts WHERE sub = ?'),
    insert: handle.prepare(
      'INSERT INTO google_accounts ' +
        '(id, sub, email, name, picture, refresh_token, root_folder_id, created_at, updated_at) ' +
        'VALUES (@id, @sub, @email, @name, @picture, @refreshToken, @rootFolderId, @now, @now)'
    ),
    update: handle.prepare(
      'UPDATE google_accounts SET email = @email, name = @name, picture = @picture, ' +
        'refresh_token = @refreshToken, root_folder_id = @rootFolderId, updated_at = @now ' +
        'WHERE id = @id'
    ),
    remove: handle.prepare('DELETE FROM google_accounts WHERE id = ?'),
    listFolders: handle.prepare(
      'SELECT * FROM account_folders WHERE account_id = ? ORDER BY created_at ASC'
    ),
    addFolder: handle.prepare(
      'INSERT INTO account_folders (account_id, id, name, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(account_id, id) DO UPDATE SET name = excluded.name'
    ),
    removeFolder: handle.prepare('DELETE FROM account_folders WHERE account_id = ? AND id = ?'),
  };

  listFoldersStmt = handle.prepare('SELECT * FROM folders ORDER BY created_at ASC');
  getFolderStmt = handle.prepare('SELECT * FROM folders WHERE id = ?');
  addFolderStmt = handle.prepare(
    'INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET name = excluded.name'
  );
  deleteFolderStmt = handle.prepare('DELETE FROM folders WHERE id = ?');

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

  seedFolders();
}

// The folder registry lives in SQLite, which a host without a persistent disk
// wipes on redeploy. Seeding from the environment means the folders come back
// on their own:
//
//   GOOGLE_DRIVE_FOLDERS=<id>|Name,<id>|Other name     (preferred)
//   GOOGLE_DRIVE_FOLDER_ID=<id>                        (single, legacy)
//
// Only runs when the table is empty, so folders added through the UI are never
// overwritten.
function seedFolders() {
  if (listFoldersStmt.all().length) return;

  const now = Date.now();
  const multi = (process.env.GOOGLE_DRIVE_FOLDERS || '').trim();
  if (multi) {
    let order = 0;
    for (const entry of multi.split(',')) {
      const [id, ...rest] = entry.split('|');
      const folderId = (id || '').trim();
      if (!folderId) continue;
      const name = rest.join('|').trim() || `Folder ${order + 1}`;
      addFolderStmt.run(folderId, name, now + order);
      order += 1;
    }
    if (listFoldersStmt.all().length) return;
  }

  const single = (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  if (single) {
    addFolderStmt.run(single, process.env.GOOGLE_DRIVE_FOLDER_NAME || 'Shared files', now);
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

// --- Drive folders ----------------------------------------------------------
//
// Every folder function takes an optional `accountId`. Without one it works on
// the shared Drive's registry (`folders`); with one, on that connected
// user's own list (`account_folders`), so users never see each other's
// folders.

const listFolders = (accountId) => {
  init();
  const rows = accountId ? acct.listFolders.all(accountId) : listFoldersStmt.all();
  return rows.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at }));
};

const getFolder = (id) => {
  init();
  return getFolderStmt.get(id) ?? null;
};

const addFolder = (id, name, accountId) => {
  init();
  if (accountId) acct.addFolder.run(accountId, id, name, Date.now());
  else addFolderStmt.run(id, name, Date.now());
};

const selectedKey = (accountId) =>
  accountId ? `selected_folder:${accountId}` : 'selected_folder';

const removeFolder = (id, accountId) => {
  init();
  const gone = accountId
    ? acct.removeFolder.run(accountId, id).changes > 0
    : deleteFolderStmt.run(id).changes > 0;
  // Never leave the selection pointing at a folder that is no longer listed.
  if (gone && getSetting(selectedKey(accountId)) === id) setSetting(selectedKey(accountId), '');
  return gone;
};

// Which folder new uploads go to, remembered across sessions. Falls back to the
// first registered folder when unset or pointing somewhere that no longer
// exists.
// The selection can be any folder in the tree, including a subfolder, so it is
// not validated against the roots table — only non-empty.
const getSelectedFolder = (accountId) => {
  const saved = getSetting(selectedKey(accountId));
  if (saved) return saved;
  return listFolders(accountId)[0]?.id || '';
};

const setSelectedFolder = (id, accountId) => {
  init();
  if (!id) return false;
  setSetting(selectedKey(accountId), String(id).trim());
  return true;
};

// --- Connected Google accounts ----------------------------------------------
//
// A browser that connected a Drive holds an "account key":
// "<account id>.<hex-hmac>". It is signed with the same secret as session
// tokens, so it cannot be forged, and it stops working the moment the account
// row is deleted (disconnect, or a wiped database).

const signAccountKey = (accountId) => {
  const sig = crypto.createHmac('sha256', getSecret()).update(`acct:${accountId}`).digest('hex');
  return `${accountId}.${sig}`;
};

// OAuth `state`: "<payload>.<hex-hmac>", so the Google callback can trust
// what it was handed back. The payload is base64url and carries a nonce and a
// timestamp; the route checks both.
const signState = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(`state:${body}`).digest('hex');
  return `${body}.${sig}`;
};

const verifyState = (state) => {
  if (typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const expected = crypto.createHmac('sha256', getSecret()).update(`state:${body}`).digest('hex');
  if (!safeEqual(state.slice(dot + 1), expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

/** The account behind an account key, or null if it is invalid or gone. */
const accountFromKey = (key) => {
  if (typeof key !== 'string' || !key) return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = key.slice(0, dot);
  if (!safeEqual(key, signAccountKey(id))) return null;
  return getAccount(id);
};

const toAccount = (row) =>
  row && {
    id: row.id,
    sub: row.sub,
    email: row.email,
    name: row.name,
    picture: row.picture,
    refreshToken: row.refresh_token,
    rootFolderId: row.root_folder_id,
    createdAt: row.created_at,
  };

const getAccount = (id) => {
  init();
  return toAccount(acct.get.get(id));
};

/**
 * Create or refresh the account for a Google user, keyed on Google's stable
 * `sub`. Reconnecting the same Google account keeps the same id, so every
 * browser that connected it keeps working.
 */
const saveAccount = ({ sub, email, name, picture, refreshToken, rootFolderId }) => {
  init();
  const existing = acct.bySub.get(sub);
  const row = {
    id: existing?.id || crypto.randomBytes(12).toString('hex'),
    sub,
    email: email || '',
    name: name || '',
    picture: picture || '',
    refreshToken,
    rootFolderId: rootFolderId || '',
    now: Date.now(),
  };
  if (existing) acct.update.run(row);
  else acct.insert.run(row);

  // The app's own folder is always one of the user's roots.
  if (row.rootFolderId && !acct.listFolders.all(row.id).some((f) => f.id === row.rootFolderId)) {
    acct.addFolder.run(row.id, row.rootFolderId, 'Share Chat', Date.now());
  }
  return getAccount(row.id);
};

const removeAccount = (id) => {
  init();
  setSetting(selectedKey(id), '');
  return acct.remove.run(id).changes > 0;
};

module.exports = {
  SESSION_MS,
  PERSIST_MS,
  listFolders,
  getFolder,
  addFolder,
  removeFolder,
  getSelectedFolder,
  setSelectedFolder,
  getPassword,
  setPassword,
  signToken,
  verifyToken,
  signAccountKey,
  accountFromKey,
  signState,
  verifyState,
  getAccount,
  saveAccount,
  removeAccount,
};
