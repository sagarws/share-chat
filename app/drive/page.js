'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Shell from '../Shell';
import {
  clearAuth,
  isAuthValid,
  getToken,
  apiHeaders,
  getDriveAccount,
  clearDriveAccount,
} from '../auth';

/**
 * Connect your own Google Drive.
 *
 * "Connect" is a plain navigation to /api/google/connect, which sends the user
 * to Google's consent screen. After they click Allow, /oauth2callback stores
 * an account key in this browser and brings them back here. From then on the
 * File Share page uploads to a "Share Chat" folder in their own Drive instead
 * of the shared one.
 */
export default function DrivePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState(null); // GET /api/google/account
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    clearAuth();
    router.replace('/');
  }, [router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/google/account', { headers: apiHeaders() });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // The stored connection is gone; forget it and show the connect button.
        clearDriveAccount();
        setError(data.error || 'Your Google Drive connection expired. Please reconnect.');
        return load();
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load your Drive status.');
      setInfo(data);
    } catch (err) {
      setError(err?.message || 'Could not load your Drive status.');
    }
  }, [logout]);

  useEffect(() => {
    if (!isAuthValid()) {
      try {
        window.sessionStorage.setItem('post-login-redirect', '/drive');
      } catch {
        // storage disabled — they'll land on the default page after signing in
      }
      router.replace('/');
      return;
    }
    setReady(true);

    // Results of the Google round trip arrive as query parameters.
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setError(params.get('error'));
    if (params.get('connected') && getDriveAccount()) {
      setNotice('Google Drive connected. Your uploads now go to your own Drive.');
    }
    if (params.toString()) window.history.replaceState({}, '', '/drive');

    load();
  }, [router, load]);

  const connect = () => {
    if (!isAuthValid()) return logout();
    setBusy(true);
    window.location.href = `/api/google/connect?token=${encodeURIComponent(getToken())}`;
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        'Disconnect your Google Drive?\n\nFiles you already uploaded stay in your Drive. ' +
          'New uploads will go to the shared Drive.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/google/account', { method: 'DELETE', headers: apiHeaders() });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      // 409 means it was already gone on the server — the result is the same.
      if (!res.ok && res.status !== 409) throw new Error(data.error || 'Could not disconnect.');
      clearDriveAccount();
      setNotice('Google Drive disconnected.');
      await load();
    } catch (err) {
      setError(err?.message || 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return null;

  const account = info?.account;

  return (
    <Shell title="Google Drive">
      <div className="drive-page">
        {error && <div className="files-notice">{error}</div>}
        {notice && <div className="drive-success">{notice}</div>}

        {!info ? (
          <p className="muted">Loading…</p>
        ) : account ? (
          <section className="drive-card">
            <div className="drive-account">
              {account.picture ? (
                // Google avatar URLs are external; a plain <img> keeps it simple.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.picture} alt="" className="drive-avatar" referrerPolicy="no-referrer" />
              ) : (
                <span className="drive-avatar placeholder">
                  {(account.name || account.email || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <div className="drive-name">{account.name}</div>
                <div className="muted">{account.email}</div>
              </div>
              <span className="drive-status">Connected</span>
            </div>

            <p className="drive-text">
              Your uploads are saved in the <strong>Share Chat</strong> folder of your own
              Google Drive.
              {account.folderId && (
                <>
                  {' '}
                  <a
                    href={`https://drive.google.com/drive/folders/${account.folderId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open it in Google Drive ↗
                  </a>
                </>
              )}
            </p>

            <div className="drive-actions">
              <Link href="/files" className="button-link">
                Go to File Share
              </Link>
              <button type="button" className="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            </div>
          </section>
        ) : (
          <section className="drive-card">
            <h2 className="drive-heading">Use your own Google Drive</h2>
            <p className="drive-text">
              Connect your Google account and the files you upload will be saved in your own
              Google Drive, in a folder called <strong>Share Chat</strong>. Google will ask
              you to allow access. This takes one click.
            </p>
            <ul className="drive-points">
              <li>The app can only see files it uploads, not the rest of your Drive.</li>
              <li>Your files stay yours, even if you disconnect later.</li>
              <li>You can remove access at any time, here or in your Google account.</li>
            </ul>

            {info.canConnect ? (
              <button type="button" className="google-btn" onClick={connect} disabled={busy}>
                <GoogleMark />
                {busy ? 'Opening Google…' : 'Connect Google Drive'}
              </button>
            ) : (
              <div className="files-notice">
                Google sign-in is not set up on this server yet. Set GOOGLE_CLIENT_ID and
                GOOGLE_CLIENT_SECRET.
              </div>
            )}

            <p className="dialog-note">
              {info.sharedConfigured
                ? 'Until you connect, uploads go to the shared Drive everyone uses.'
                : 'Until you connect, there is nowhere to upload to.'}{' '}
              See our <Link href="/privacy">privacy policy</Link>.
            </p>
          </section>
        )}
      </div>
    </Shell>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
