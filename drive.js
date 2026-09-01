// Minimal Google Drive v3 client — no SDK, just fetch.
//
// Auth model: a long-lived refresh token (minted once by
// scripts/get-google-refresh-token.js) is traded for short-lived access
// tokens, which we cache in memory until just before they expire.
//
// Scope is drive.file, so this app can only ever see files it created
// itself — the rest of the owner's Drive is invisible to it.

const { getDriveFolder, setDriveFolder } = require('./db');

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_API = 'https://oauth2.googleapis.com/token';

const config = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
});

const isConfigured = () => {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.refreshToken && c.folderId);
};

// Cached access token. Google's expire in ~1h; refresh 60s early so a
// long-running upload doesn't start with a token that dies mid-flight.
let cached = { token: '', expiresAt: 0 };

const getAccessToken = async () => {
  const c = config();
  if (!isConfigured()) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
        'GOOGLE_REFRESH_TOKEN and GOOGLE_DRIVE_FOLDER_ID.'
    );
  }
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(TOKEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    cached = { token: '', expiresAt: 0 };
    // invalid_grant almost always means the OAuth app is still in "Testing"
    // (Google expires those refresh tokens after 7 days) or access was revoked.
    const hint =
      data.error === 'invalid_grant'
        ? ' — the refresh token was revoked or expired. Publish the OAuth app ' +
          '(Google Auth Platform → Audience → Publish app) and re-run ' +
          'scripts/get-google-refresh-token.js.'
        : '';
    throw new Error(
      `Google token refresh failed: ${data.error_description || data.error || res.status}${hint}`
    );
  }

  const ttl = Number(data.expires_in) || 3600;
  cached = { token: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return cached.token;
};

const authHeaders = async () => ({ Authorization: `Bearer ${await getAccessToken()}` });

const APP_FOLDER_NAME = 'share-chat-uploads';

/** Create a folder in the authorising account's Drive root. */
const createAppFolder = async () => {
  const res = await fetch(`${FILES_API}?fields=id`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(
      `Could not create the Drive folder (${res.status}). ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return data.id;
};

/**
 * Upload bytes to the configured folder using a resumable session, so the
 * request body streams through instead of being buffered in memory. Returns
 * the new Drive file id.
 *
 * @param {object}  opts
 * @param {string}  opts.name
 * @param {string}  opts.mime
 * @param {number}  opts.size          exact byte length of `body`
 * @param {ReadableStream|Buffer} opts.body
 */
const uploadFile = async ({ name, mime, size, uploader, body }) => {
  const startSession = async (folderId) =>
    fetch(`${UPLOAD_API}?uploadType=resumable&supportsAllDrives=true`, {
      method: 'POST',
      headers: {
        ...(await authHeaders()),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        name,
        parents: [folderId],
        // appProperties are private to this OAuth client, so the uploader's
        // name rides along with the file instead of living in a local table
        // that a redeploy would wipe.
        appProperties: uploader ? { uploader } : undefined,
      }),
    });

  // Prefer a folder we created earlier (see the 404 fallback below), else the
  // one from the environment.
  let folderId = getDriveFolder() || config().folderId;
  let initRes = await startSession(folderId);

  // Under the drive.file scope Drive only acknowledges folders this app
  // created, so a folder made by hand in the web UI can come back as
  // "File not found: <id>". Create our own folder once and use it from then on.
  if (initRes.status === 404) {
    folderId = await createAppFolder();
    setDriveFolder(folderId);
    console.warn(
      `[drive] GOOGLE_DRIVE_FOLDER_ID was unreachable under the drive.file scope. ` +
        `Created "${APP_FOLDER_NAME}" (${folderId}) and will upload there instead.`
    );
    initRes = await startSession(folderId);
  }

  if (!initRes.ok) {
    const detail = await initRes.text().catch(() => '');
    throw new Error(`Drive rejected the upload (${initRes.status}). ${detail.slice(0, 300)}`);
  }

  const session = initRes.headers.get('location');
  if (!session) throw new Error('Drive did not return an upload session URL.');

  const isStream = body && typeof body.getReader === 'function';
  const putRes = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
    body,
    // Required by undici to send a streaming request body.
    ...(isStream ? { duplex: 'half' } : {}),
  });

  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '');
    throw new Error(`Drive upload failed (${putRes.status}). ${detail.slice(0, 300)}`);
  }

  const created = await putRes.json().catch(() => ({}));
  if (!created.id) throw new Error('Drive did not return a file id.');
  return created.id;
};

const FILE_FIELDS =
  'id,name,mimeType,size,createdTime,appProperties,webViewLink,shared';

/**
 * List every file this app created, newest first.
 *
 * Under the drive.file scope Drive only ever returns files created by this
 * OAuth client, so the result set is exactly our uploads — no parent filter
 * needed, and nothing to reconcile against a local database. This is what
 * makes the listing survive a wiped disk.
 */
const listDriveFiles = async () => {
  const out = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      q: "mimeType != 'application/vnd.google-apps.folder' and trashed = false",
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      orderBy: 'createdTime desc',
      pageSize: '200',
      supportsAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${FILES_API}?${params}`, { headers: await authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `Drive listing failed (${res.status}). ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    for (const f of data.files || []) {
      out.push({
        id: f.id,
        name: f.name,
        mime: f.mimeType || 'application/octet-stream',
        size: Number(f.size) || 0,
        uploader: f.appProperties?.uploader || '',
        createdAt: Date.parse(f.createdTime) || 0,
        link: f.webViewLink || '',
        shared: Boolean(f.shared),
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return out;
};

/** Metadata for one file, or null if it is gone. */
const getFileMeta = async (fileId) => {
  const res = await fetch(
    `${FILES_API}/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}&supportsAllDrives=true`,
    { headers: await authHeaders() }
  );
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Drive lookup failed (${res.status}). ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    id: data.id,
    name: data.name,
    mime: data.mimeType || 'application/octet-stream',
    size: Number(data.size) || 0,
    uploader: data.appProperties?.uploader || '',
    createdAt: Date.parse(data.createdTime) || 0,
    link: data.webViewLink || '',
    shared: Boolean(data.shared),
  };
};

/**
 * Open a Drive file for reading. Returns the raw fetch Response so the caller
 * can hand `.body` straight to the client without buffering.
 */
const downloadFile = async (fileId) => {
  const res = await fetch(
    `${FILES_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: await authHeaders() }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive download failed (${res.status}). ${detail.slice(0, 300)}`);
  }
  return res;
};

/**
 * Make a file readable by anyone holding its link, and return that link.
 *
 * This deliberately steps outside the app's password gate: the returned URL
 * works for anyone, signed in or not. Only called when a user explicitly asks
 * for a shareable Drive link.
 */
const shareFile = async (fileId) => {
  const meta = await getFileMeta(fileId);
  if (!meta) return null;

  if (!meta.shared) {
    const res = await fetch(
      `${FILES_API}/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Could not share the file (${res.status}). ${detail.slice(0, 300)}`);
    }
  }

  // webViewLink is only populated once the file is readable, so re-read it.
  const fresh = await getFileMeta(fileId);
  const link = fresh?.link || `https://drive.google.com/file/d/${fileId}/view`;
  return link;
};

/** Delete a Drive file. A 404 counts as success — it's already gone. */
const deleteFile = async (fileId) => {
  const res = await fetch(
    `${FILES_API}/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    { method: 'DELETE', headers: await authHeaders() }
  );
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive delete failed (${res.status}). ${detail.slice(0, 300)}`);
  }
};

module.exports = {
  isConfigured,
  uploadFile,
  listDriveFiles,
  getFileMeta,
  shareFile,
  downloadFile,
  deleteFile,
};
