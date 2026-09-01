'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MenuBar from '../MenuBar';
import { clearAuth, isAuthValid, getToken } from '../auth';

// Fallback only — the real cap comes from GET /api/files, which reads
// MAX_UPLOAD_BYTES on the server. Keeping them in sync avoids a client-side
// limit that silently disagrees with what the route will accept.
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatWhen = (ts) => {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
        ' · ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const iconFor = (mime, name) => {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (/zip|compressed|tar|rar|7z/.test(mime)) return '🗜️';
  if (/^text\/|json|xml|javascript/.test(mime)) return '📝';
  if (/\.(docx?|odt)$/i.test(name)) return '📘';
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return '📗';
  return '📄';
};

export default function FilesPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [maxBytes, setMaxBytes] = useState(DEFAULT_MAX_BYTES);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState(null); // { name, size, percent }
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [copied, setCopied] = useState('');
  const [copying, setCopying] = useState('');
  const [view, setView] = useState('list');

  const inputRef = useRef(null);
  const xhrRef = useRef(null);

  const logout = useCallback(() => {
    clearAuth();
    router.replace('/');
  }, [router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/files', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load files.');
      setFiles(data.files || []);
      setConfigured(data.configured !== false);
      if (Number(data.maxBytes) > 0) setMaxBytes(Number(data.maxBytes));
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load files.');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  // Gate the page on the same token the chat uses, then fetch the list.
  useEffect(() => {
    if (!isAuthValid()) {
      // Remember the shared link so signing in lands them on the right file
      // instead of dumping them in the chat.
      try {
        window.sessionStorage.setItem(
          'post-login-redirect',
          window.location.pathname + window.location.search
        );
      } catch {
        // storage disabled — they'll just land on the chat after signing in
      }
      router.replace('/');
      return;
    }
    setReady(true);
    try {
      const saved = window.localStorage.getItem('files-view');
      if (saved === 'grid' || saved === 'list') setView(saved);
    } catch {
      // storage disabled — default to list
    }
    load();
  }, [router, load]);

  // A ?f=<id> link opens the file directly. Done once the list has loaded so
  // an id that no longer exists can be reported instead of silently failing.
  useEffect(() => {
    if (!ready || loading) return;
    const wanted = new URLSearchParams(window.location.search).get('f');
    if (!wanted) return;

    window.history.replaceState({}, '', '/files');
    const row = files.find((f) => f.id === wanted);
    if (!row) {
      setError('That shared file is no longer available.');
      return;
    }
    window.location.href = downloadHref(row.id);
    // downloadHref is stable for a given token; files/loading drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, files]);

  // Mirror the chat's session watchdog so a page left open eventually logs out.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      if (!isAuthValid()) logout();
    };
    const int = setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(int);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ready, logout]);

  // XHR rather than fetch: it's the only way to get upload progress events.
  const startUpload = (file) => {
    if (!file || upload) return;
    if (file.size === 0) {
      setError('That file is empty.');
      return;
    }
    if (file.size > maxBytes) {
      setError(`File is too large (max ${formatSize(maxBytes)}).`);
      return;
    }
    if (!isAuthValid()) return logout();

    setError('');
    setUpload({ name: file.name, size: file.size, percent: 0 });

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
    // Name the uploader if they already joined the chat in this browser.
    const who = window.sessionStorage.getItem('chat-username') || '';
    if (who) xhr.setRequestHeader('X-Uploader', encodeURIComponent(who));

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      setUpload((u) => (u ? { ...u, percent: Math.round((e.loaded / e.total) * 100) } : u));
    };

    xhr.onload = () => {
      xhrRef.current = null;
      setUpload(null);
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* fall through to the generic message below */
      }
      if (xhr.status === 401) return logout();
      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        setFiles((prev) => [data.file, ...prev]);
      } else {
        setError(data.error || `Upload failed (${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setUpload(null);
      setError('Upload failed — could not reach the server.');
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      setUpload(null);
    };

    xhr.send(file);
  };

  const chooseView = (next) => {
    setView(next);
    try {
      window.localStorage.setItem('files-view', next);
    } catch {
      // storage disabled — the choice just won't persist
    }
  };

  const thumbHref = (id, size) =>
    `/api/files/${id}/thumb?s=${size}&token=${encodeURIComponent(getToken())}`;

  const handleDelete = async (row) => {
    if (deleting) return;
    if (!window.confirm(`Delete "${row.name}"? This removes it from Drive too.`)) return;
    setDeleting(row.id);
    try {
      const res = await fetch(`/api/files/${row.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
      setFiles((prev) => prev.filter((f) => f.id !== row.id));
      setError('');
    } catch (err) {
      setError(err?.message || 'Delete failed.');
    } finally {
      setDeleting('');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    startUpload(e.dataTransfer.files?.[0]);
  };

  // Downloads are plain navigations, so the token rides in the query string.
  const downloadHref = (id) =>
    `/api/files/${id}?token=${encodeURIComponent(getToken())}`;

  // Copy a Google Drive link. This asks the server to grant "anyone with the
  // link can view" on the Drive file, so the resulting URL works for people
  // who do not have the app's password — that is the point of it, and why the
  // button warns before the first share.
  const handleCopy = async (row) => {
    if (copying) return;
    if (!row.shared) {
      const ok = window.confirm(
        `Create a public Google Drive link for "${row.name}"?\n\n` +
          'Anyone with the link will be able to view this file without signing in.'
      );
      if (!ok) return;
    }
    setCopying(row.id);
    setError('');
    try {
      const res = await fetch(`/api/files/${row.id}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.link) {
        throw new Error(data.error || 'Could not create a share link.');
      }

      try {
        await navigator.clipboard.writeText(data.link);
      } catch {
        // clipboard API needs a secure context; fall back to a hidden textarea
        const ta = document.createElement('textarea');
        ta.value = data.link;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const worked = (() => {
          try {
            return document.execCommand('copy');
          } catch {
            return false;
          }
        })();
        document.body.removeChild(ta);
        if (!worked) {
          setError(`Copy failed. Link: ${data.link}`);
          return;
        }
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === row.id ? { ...f, shared: true, link: data.link } : f))
      );
      setCopied(row.id);
      setTimeout(() => setCopied((c) => (c === row.id ? '' : c)), 1600);
    } catch (err) {
      setError(err?.message || 'Could not create a share link.');
    } finally {
      setCopying('');
    }
  };

  if (!ready) return null;

  return (
    <>
      <MenuBar authed current="files" />
      <div className="screen">
        <header className="header">
          <div>
            <strong>File Share</strong>
            <span className="muted"> · {files.length} file{files.length === 1 ? '' : 's'}</span>
          </div>
          <div className="view-toggle" role="group" aria-label="View">
            <button
              type="button"
              className={view === 'list' ? 'active' : undefined}
              onClick={() => chooseView('list')}
              aria-pressed={view === 'list'}
              title="List view"
            >
              ☰
            </button>
            <button
              type="button"
              className={view === 'grid' ? 'active' : undefined}
              onClick={() => chooseView('grid')}
              aria-pressed={view === 'grid'}
              title="Gallery view"
            >
              ▦
            </button>
          </div>
        </header>

        <main
          className={`files-main${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {!configured && (
            <div className="files-notice">
              Google Drive isn’t connected yet. Run{' '}
              <code>node scripts/get-google-refresh-token.js</code> and restart the
              server.
            </div>
          )}

          <button
            type="button"
            className="drop-zone"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(upload)}
          >
            <span className="drop-icon">⬆️</span>
            <span className="drop-title">
              {upload ? 'Uploading…' : 'Click to choose a file, or drop it here'}
            </span>
            <span className="drop-hint">Up to {formatSize(maxBytes)}</span>
          </button>

          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              startUpload(picked);
            }}
          />

          {upload && (
            <div className="upload-row">
              <span className="file-name">{upload.name}</span>
              <span className="progress-track">
                <span className="progress-fill" style={{ width: `${upload.percent}%` }} />
              </span>
              <span className="file-meta">{upload.percent}%</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => xhrRef.current?.abort()}
                aria-label="Cancel upload"
              >
                ✕
              </button>
            </div>
          )}

          {error && <div className="composer-error">{error}</div>}

          {loading ? (
            <div className="empty muted">Loading…</div>
          ) : files.length === 0 ? (
            <div className="empty muted">No files shared yet.</div>
          ) : (
            <ul className={view === 'grid' ? 'file-grid' : 'file-list'}>
              {files.map((f) =>
                view === 'grid' ? (
                  <li key={f.id} className="file-card">
                    <a
                      className="card-preview"
                      href={downloadHref(f.id)}
                      download={f.name}
                      aria-label={`Download ${f.name}`}
                    >
                      {f.hasThumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={thumbHref(f.id, 400)}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            // Drive has no preview for this one after all —
                            // drop back to the type icon.
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span
                        className="card-icon"
                        style={f.hasThumb ? { display: 'none' } : undefined}
                      >
                        {iconFor(f.mime, f.name)}
                      </span>
                      {f.shared && <span className="card-badge" title="Public link">🌐</span>}
                    </a>

                    <div className="card-body">
                      <span className="file-name" title={f.name}>
                        {f.name}
                      </span>
                      <span className="file-meta">
                        {formatSize(f.size)} · {formatWhen(f.createdAt)}
                      </span>
                    </div>

                    <div className="card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => handleCopy(f)}
                        disabled={copying === f.id}
                        aria-label={`Copy Google Drive link to ${f.name}`}
                        title={
                          f.shared
                            ? 'Copy public Google Drive link'
                            : 'Create a public Google Drive link'
                        }
                      >
                        {copied === f.id ? '✅' : copying === f.id ? '…' : '🔗'}
                      </button>
                      <a
                        className="icon-btn"
                        href={downloadHref(f.id)}
                        download={f.name}
                        aria-label={`Download ${f.name}`}
                      >
                        ⬇️
                      </a>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => handleDelete(f)}
                        disabled={deleting === f.id}
                        aria-label={`Delete ${f.name}`}
                      >
                        {deleting === f.id ? '…' : '🗑️'}
                      </button>
                    </div>
                  </li>
                ) : (
                <li key={f.id} className="file-row">
                  <span className="file-icon">{iconFor(f.mime, f.name)}</span>
                  <span className="file-info">
                    <span className="file-name">{f.name}</span>
                    <span className="file-meta">
                      {formatSize(f.size)}
                      {f.uploader ? ` · ${f.uploader}` : ''} · {formatWhen(f.createdAt)}
                      {f.shared ? ' · 🌐 public link' : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleCopy(f)}
                    disabled={copying === f.id}
                    aria-label={`Copy Google Drive link to ${f.name}`}
                    title={
                      f.shared
                        ? 'Copy public Google Drive link'
                        : 'Create a public Google Drive link'
                    }
                  >
                    {copied === f.id ? '✅' : copying === f.id ? '…' : '🔗'}
                  </button>
                  <a className="icon-btn" href={downloadHref(f.id)} download={f.name} aria-label={`Download ${f.name}`}>
                    ⬇️
                  </a>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => handleDelete(f)}
                    disabled={deleting === f.id}
                    aria-label={`Delete ${f.name}`}
                  >
                    {deleting === f.id ? '…' : '🗑️'}
                  </button>
                </li>
                )
              )}
            </ul>
          )}
        </main>
      </div>
    </>
  );
}
