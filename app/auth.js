'use client';

// Client-side view of the session minted by POST /api/login. The token itself
// is the only thing that matters — every server route re-verifies it, so the
// checks here are just to avoid rendering screens the server would reject.

export const AUTH_KEY = 'chat-auth';
export const EDIT_KEY = 'edit';

export const readAuth = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearAuth = () => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_KEY);
};

// Cheap client-side gate: was the token still in-window last we heard? The
// authoritative check is server-side — POST /api/login mints it, and every
// mutating call (socket handshake, /api/files) verifies it.
export const isAuthValid = () => {
  const rec = readAuth();
  if (!rec || typeof rec !== 'object') return false;
  if (typeof rec.token !== 'string' || !rec.token) return false;
  if (typeof rec.expiresAt !== 'number') return false;
  return rec.expiresAt > Date.now();
};

export const getToken = () => readAuth()?.token || '';

export const isEditMode = () =>
  typeof window !== 'undefined' && window.localStorage.getItem(EDIT_KEY) === 'true';

// --- Connected Google Drive -------------------------------------------------
//
// A browser that connected its own Google Drive on the /drive page holds an
// account key here (written by /oauth2callback). Every Drive request sends it
// so the server uses that Drive instead of the shared one.

export const DRIVE_KEY = 'drive-account';

export const getDriveAccount = () => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(DRIVE_KEY) || '';
  } catch {
    return '';
  }
};

export const clearDriveAccount = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRIVE_KEY);
  } catch {
    // storage disabled — nothing stored to clear
  }
};

/** Headers for an authenticated API call: session token plus Drive account. */
export const apiHeaders = (extra = {}) => {
  const headers = { Authorization: `Bearer ${getToken()}`, ...extra };
  const account = getDriveAccount();
  if (account) headers['X-Drive-Account'] = account;
  return headers;
};

/** The same, as a query string, for <a>/<img> URLs that cannot set headers. */
export const authQuery = () => {
  const params = new URLSearchParams({ token: getToken() });
  const account = getDriveAccount();
  if (account) params.set('account', account);
  return params.toString();
};
