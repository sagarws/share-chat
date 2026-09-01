'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AUTH_KEY, isEditMode } from './auth';

/**
 * Fixed panel in the top-left corner, rendered on every route.
 *
 * Two tiers of content:
 *  - navigation (Chat ↔ File Share) — any signed-in user
 *  - password change — only when localStorage.edit === 'true'
 *
 * @param {boolean} authed   user is past the password screen
 * @param {'chat'|'files'} current  which page is showing, to hide its own link
 */
export default function MenuBar({ authed = false, current = 'chat' }) {
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // localStorage is unavailable during SSR, so this can only run after mount.
  useEffect(() => setEdit(isEditMode()), []);

  // Nothing to offer a signed-out, non-edit visitor.
  if (!authed && !edit) return null;

  const handleChange = async (e) => {
    e.preventDefault();
    const pwd = newPwd.trim();
    if (!pwd || busy) return;
    setBusy(true);
    setStatus('Saving…');
    try {
      const res = await fetch('/api/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      setStatus('Saved. Reloading…');
      // Force everyone on this browser back to the login screen — the token
      // we hold was minted against the old pwd, and the new pwd is now the
      // one users need to type.
      window.localStorage.removeItem(AUTH_KEY);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      setStatus(err?.message || 'Save failed.');
      setBusy(false);
    }
  };

  return (
    <aside className="menu-bar" aria-label="Menu">
      <button
        type="button"
        className="menu-toggle"
        onClick={() => {
          setOpen((v) => !v);
          setStatus('');
        }}
        aria-expanded={open}
      >
        {open ? 'Close' : 'Menu'}
      </button>

      {open && (
        <div className="menu-panel">
          {authed && (
            <nav className="menu-nav">
              {current !== 'chat' && (
                <Link href="/" className="menu-link" onClick={() => setOpen(false)}>
                  💬 Chat
                </Link>
              )}
              {current !== 'files' && (
                <Link href="/files" className="menu-link" onClick={() => setOpen(false)}>
                  📁 File Share
                </Link>
              )}
            </nav>
          )}

          {edit && (
            <form className="menu-form" onSubmit={handleChange}>
              <label htmlFor="new-pwd">New password</label>
              <input
                id="new-pwd"
                type="text"
                autoComplete="off"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                maxLength={100}
                disabled={busy}
              />
              <button type="submit" disabled={!newPwd.trim() || busy}>
                Change password
              </button>
            </form>
          )}

          {status && <span className="menu-status">{status}</span>}
        </div>
      )}
    </aside>
  );
}
