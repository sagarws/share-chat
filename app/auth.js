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
