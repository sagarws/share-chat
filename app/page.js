'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AUTH_KEY, isAuthValid, isEditMode } from './auth';

// File Share is the default landing page; Chat lives at /chat.
const HOME = '/files';

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    if (isAuthValid()) {
      router.replace(HOME);
      return;
    }
    setChecking(false);
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!pwd || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Edit mode asks the server for a session that never expires.
        body: JSON.stringify({ pwd, persist: isEditMode() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Incorrect password.');
        setBusy(false);
        return;
      }
      window.localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({ token: data.token, expiresAt: data.expiresAt })
      );

      // Someone who followed a share link gets sent back to it rather than
      // dropped on the default page.
      let next = HOME;
      try {
        const saved = window.sessionStorage.getItem('post-login-redirect');
        if (saved) {
          window.sessionStorage.removeItem('post-login-redirect');
          next = saved;
        }
      } catch {
        // storage disabled — fall through to the default
      }
      router.replace(next);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  };

  // Avoid flashing the password form at someone who is already signed in.
  if (checking) return null;

  return (
    <div className="screen center">
      <form className="join-card" onSubmit={handleLogin}>
        <h1>Sign in</h1>
        <p className="muted">Enter the password to continue.</p>
        <input
          autoFocus
          type="password"
          placeholder="Password"
          value={pwd}
          onChange={(e) => {
            setPwd(e.target.value);
            if (error) setError('');
          }}
          maxLength={100}
          disabled={busy}
        />
        {error && <div className="composer-error">{error}</div>}
        <button type="submit" disabled={!pwd || busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
      <p className="legal-links">
        <Link href="/privacy">Privacy Policy</Link> ·{' '}
        <Link href="/terms">Terms of Service</Link>
      </p>
    </div>
  );
}
