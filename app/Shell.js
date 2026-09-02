'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AUTH_KEY, isEditMode } from './auth';

const NAV = [
  { href: '/files', label: 'File Share', icon: '📁' },
  { href: '/chat', label: 'Chat', icon: '💬' },
];

/**
 * App shell for every signed-in page: fixed header across the top, navigation
 * sidebar down the left, page content in the remaining space.
 *
 * The sidebar collapses behind a toggle on narrow screens. The password form
 * lives in the sidebar footer and only appears when localStorage.edit is
 * 'true' — the same gate the old floating menu used.
 *
 * @param {string}      title    page name shown in the header
 * @param {ReactNode}   actions  optional header-right content (status, buttons)
 * @param {ReactNode}   aside    optional sidebar content below the nav
 * @param {ReactNode}   children page body
 */
export default function Shell({ title, actions, aside, children }) {
  const pathname = usePathname();
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // localStorage is unavailable during SSR, so this can only run after mount.
  useEffect(() => setEdit(isEditMode()), []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  const handleChangePwd = async (e) => {
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
      // The token we hold was minted against the old password, so force this
      // browser back to the login screen.
      window.localStorage.removeItem(AUTH_KEY);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      setStatus(err?.message || 'Save failed.');
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <header className="shell-header">
        <button
          type="button"
          className="nav-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          ☰
        </button>
        <span className="shell-brand">Share Chat</span>
        <span className="shell-title">{title}</span>
        <div className="shell-actions">{actions}</div>
      </header>

      <div className="shell-body">
        {open && (
          <button
            type="button"
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
        )}

        <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Sections">
          <ul className="nav-list">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {aside}

          {edit && (
            <form className="sidebar-foot" onSubmit={handleChangePwd}>
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
              {status && <span className="menu-status">{status}</span>}
            </form>
          )}
        </nav>

        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
