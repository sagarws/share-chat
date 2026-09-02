'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '../Shell';
import FolderTree from '../FolderTree';
import { clearAuth, isAuthValid, getToken } from '../auth';
import { fileFromPaste } from '../clipboard';
import { addCaption, isImage } from '../imageCaption';

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

// Types the in-app viewer can actually render. Everything else only offers a
// download.
const canPreview = (mime) =>
  mime.startsWith('image/') ||
  mime.startsWith('video/') ||
  mime.startsWith('audio/') ||
  mime === 'application/pdf';

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
  const [viewing, setViewing] = useState(null);
  const [descDraft, setDescDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);
  // An image waiting on the "add a description?" question.
  const [pending, setPending] = useState(null);
  const [pendingText, setPendingText] = useState('');
  const [stampCaption, setStampCaption] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState('');
  const [tree, setTree] = useState([]);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState({ name: '', id: '' });
  const [view, setView] = useState('list');

  const inputRef = useRef(null);
  const xhrRef = useRef(null);

  const logout = useCallback(() => {
    clearAuth();
    router.replace('/');
  }, [router]);

  // Fetch one folder's files. Passing an explicit id avoids waiting for the
  // folder state to settle after a switch.
  const loadFiles = useCallback(
    async (id) => {
      const target = id === undefined ? folderId : id;
      if (!target) {
        setFiles([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/files?folder=${encodeURIComponent(target)}`, {
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
        setFiles([]);
        setError(err?.message || 'Could not load files.');
      } finally {
        setLoading(false);
      }
    },
    [folderId, logout]
  );

  // The tree is built server-side by walking Drive; this only fetches it.
  // Fetch the server-built tree.
  //
  // `expectId` guards against Drive's folder index lagging behind creation: a
  // response that does not yet contain a folder we know exists would wipe it
  // from the UI, so hold the current tree and retry instead of applying it.
  const loadTree = useCallback(
    async (refresh, expectId, attempt = 0) => {
      try {
        const res = await fetch(`/api/folders/tree${refresh ? '?refresh=1' : ''}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.status === 401) return logout();
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) return;

        if (expectId) {
          const has = (nodes) =>
            nodes.some((n) => n.id === expectId || has(n.children || []));
          if (!has(data.tree || [])) {
            // Give Drive a moment, then look again — up to ~30s.
            if (attempt < 5) {
              setTimeout(() => loadTree(true, expectId, attempt + 1), 5000);
            }
            return;
          }
        }
        setTree(data.tree || []);
      } catch {
        // a missing tree only costs the panel; the file list still works
      }
    },
    [logout]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load folders.');
      setFolders(data.folders || []);
      setFolderId(data.selected || '');
      loadTree();
      await loadFiles(data.selected || '');
    } catch (err) {
      setError(err?.message || 'Could not load folders.');
      setLoading(false);
    }
    // loadFiles/loadTree are recreated per render but only read what we pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const startUpload = (file, options = {}) => {
    if (!file || upload) return;

    // Images get the chance to carry a description — both into Drive's
    // metadata and, optionally, printed under the image itself.
    if (isImage(file) && !options.answered) {
      setPending(file);
      setPendingText(descDraft.trim());
      setStampCaption(true);
      return;
    }

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
    if (folderId) xhr.setRequestHeader('X-Folder', encodeURIComponent(folderId));
    const note = (options.description ?? descDraft).trim();
    if (note) xhr.setRequestHeader('X-Description', encodeURIComponent(note));
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
        setDescDraft('');
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

  // Switching folders also stores the choice server-side, so it is the default
  // the next time anyone opens the page.
  const chooseFolder = async (id) => {
    if (id === folderId) return;
    setFolderId(id);
    setViewing(null);
    loadFiles(id);
    try {
      await fetch('/api/folders', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ selected: id }),
      });
    } catch {
      // the switch still works for this session; only the default is lost
    }
  };

  const handleAddFolder = async (e) => {
    e.preventDefault();
    const name = newFolder.name.trim();
    const id = newFolder.id.trim();
    if (!name || !id) return;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ name, id }),
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not add folder.');
      setFolders(data.folders || []);
      setNewFolder({ name: '', id: '' });
      setAddingFolder(false);
      setError('');
      const added = (data.folders || []).find((f) => f.name === name);
      if (added) chooseFolder(added.id);
      loadTree(true);
    } catch (err) {
      setError(err?.message || 'Could not add folder.');
    }
  };

  const handleRemoveFolder = async (folder) => {
    if (!window.confirm(`Remove "${folder.name}" from the list?\n\nThe folder and its files stay in Google Drive.`)) return;
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folder.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not remove folder.');
      setFolders(data.folders || []);
      setFolderId(data.selected || '');
      loadFiles(data.selected || '');
      loadTree(true);
    } catch (err) {
      setError(err?.message || 'Could not remove folder.');
    }
  };

  // Create a real subfolder in Drive. Folders made this way are app-created, so
  // the drive.file scope can see them and they show up in the tree.
  const handleAddSubfolder = async (parent, rawName) => {
    const name = (rawName || '').trim();
    if (!name) return;
    try {
      const res = await fetch('/api/folders/subfolder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ name, parentId: parent.id }),
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not create the folder.');
      setError('');

      // Drive's folder index lags a second or two behind creation, so a refetch
      // right now often comes back without the new folder. Insert it locally so
      // it appears immediately, then reconcile in the background.
      const graft = (nodes) =>
        nodes.map((n) =>
          n.id === parent.id
            ? { ...n, children: [...(n.children || []), { ...data.folder, children: [] }] }
            : { ...n, children: graft(n.children || []) }
        );
      setTree((prev) => graft(prev));
      chooseFolder(data.folder.id);
      // Reconcile once Drive has indexed it; until then the local node stands.
      setTimeout(() => loadTree(true, data.folder.id), 4000);
    } catch (err) {
      setError(err?.message || 'Could not create the folder.');
    }
  };

  const chooseView = (next) => {
    setView(next);
    try {
      window.localStorage.setItem('files-view', next);
    } catch {
      // storage disabled — the choice just won't persist
    }
  };

  // `inline` makes the server send Content-Disposition: inline, so the browser
  // renders the file instead of downloading it.
  const viewHref = (id) =>
    `/api/files/${id}?inline=1&token=${encodeURIComponent(getToken())}`;

  const thumbHref = (id, size) =>
    `/api/files/${id}/thumb?s=${size}&token=${encodeURIComponent(getToken())}`;

  // Paste an image (or any copied file) anywhere on the page to upload it.
  // Registered after `startUpload` exists and re-registered whenever the
  // things it closes over change, so it never uploads with a stale cap.
  useEffect(() => {
    if (!ready) return;
    const onPaste = (e) => {
      const picked = fileFromPaste(e);
      if (!picked) return;
      e.preventDefault();
      startUpload(picked);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // startUpload is redefined each render but only reads state we list here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, upload, maxBytes]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setViewing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  // "Skip" uploads the original untouched; confirming stores the text as the
  // Drive description and, when asked, renders it under the image first.
  const confirmPending = async (withDescription) => {
    const file = pending;
    if (!file || preparing) return;
    const text = withDescription ? pendingText.trim() : '';

    setPreparing(true);
    try {
      let toUpload = file;
      if (text && stampCaption) {
        toUpload = await addCaption(file, text);
        if (toUpload.size > maxBytes) {
          setError(
            `With the caption added the image is ${formatSize(toUpload.size)}, over the ` +
              `${formatSize(maxBytes)} limit. Uncheck the caption or shorten the text.`
          );
          return;
        }
      }
      setPending(null);
      setPendingText('');
      startUpload(toUpload, { answered: true, description: text });
    } catch (err) {
      setError(err?.message || 'Could not prepare the image.');
    } finally {
      setPreparing(false);
    }
  };

  const openEditor = (row) => {
    setEditing(row);
    setEditText(row.description || '');
  };

  const saveDescription = async (e) => {
    e.preventDefault();
    if (!editing || savingDesc) return;
    setSavingDesc(true);
    try {
      const res = await fetch(`/api/files/${editing.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ description: editText }),
      });
      if (res.status === 401) return logout();
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setFiles((prev) =>
        prev.map((f) => (f.id === editing.id ? { ...f, description: data.description } : f))
      );
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not save the description.');
    } finally {
      setSavingDesc(false);
    }
  };

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
  // link can view" on the Drive file, so the resulting URL works for people who
  // do not have the app's password — that is the point of it. Sharing happens
  // on the first click with no prompt; the 🌐 badge in the list is what marks a
  // file as public afterwards.
  const handleCopy = async (row) => {
    if (copying) return;
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

  // Name of the open folder, found anywhere in the tree.
  const findName = (nodes) => {
    for (const n of nodes) {
      if (n.id === folderId) return n.name;
      const hit = findName(n.children || []);
      if (hit) return hit;
    }
    return '';
  };
  const currentFolderName = findName(tree);

  if (!ready) return null;

  return (
    <Shell
      title="File Share"
      actions={
        <>
          <span className="muted">
            {currentFolderName ? `${currentFolderName} · ` : ''}
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
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
        </>
      }
    >
      <div className="files-layout">
          <aside className="files-panel">
            <div className="sidebar-heading">
              <span>Folders</span>
              <button
                type="button"
                onClick={() => loadTree(true)}
                aria-label="Refresh folder tree"
                title="Refresh"
              >
                ⟳
              </button>
            </div>

            {tree.length === 0 ? (
              <p className="sidebar-hint">No folders yet.</p>
            ) : (
              <FolderTree
                nodes={tree}
                selectedId={folderId}
                onSelect={chooseFolder}
                onCreate={handleAddSubfolder}
                onRemove={handleRemoveFolder}
              />
            )}

            {addingFolder ? (
              <form className="folder-form" onSubmit={handleAddFolder}>
                <input
                  autoFocus
                  placeholder="Name"
                  value={newFolder.name}
                  onChange={(e) => setNewFolder((v) => ({ ...v, name: e.target.value }))}
                  maxLength={60}
                />
                <input
                  placeholder="Drive folder id or URL"
                  value={newFolder.id}
                  onChange={(e) => setNewFolder((v) => ({ ...v, id: e.target.value }))}
                />
                <div className="folder-form-row">
                  <button type="submit" disabled={!newFolder.name.trim() || !newFolder.id.trim()}>
                    Add
                  </button>
                  <button type="button" className="ghost" onClick={() => setAddingFolder(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="folder-add"
                onClick={() => setAddingFolder(true)}
              >
                + Add folder
              </button>
            )}
          </aside>

        <div
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

          <input
            className="desc-field"
            placeholder="Description for the next upload (optional) — shows in Google Drive"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            maxLength={500}
            disabled={Boolean(upload) || !folderId}
          />

          <button
            type="button"
            className="drop-zone"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(upload) || !folderId}
          >
            <span className="drop-icon">⬆️</span>
            <span className="drop-title">
              {upload ? 'Uploading…' : 'Click to choose a file, drop it here, or paste'}
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
          ) : folders.length === 0 ? (
            <div className="empty muted">
              No Drive folders yet. Add one above to start uploading.
            </div>
          ) : files.length === 0 ? (
            <div className="empty muted">Nothing in this folder yet.</div>
          ) : (
            <ul className={view === 'grid' ? 'file-grid' : 'file-list'}>
              {files.map((f) =>
                view === 'grid' ? (
                  <li key={f.id} className="file-card">
                    {/* Opens the viewer for previewable files; otherwise
                        falls back to downloading. */}
                    <button
                      type="button"
                      className="card-preview"
                      onClick={() =>
                        canPreview(f.mime)
                          ? setViewing(f)
                          : window.location.assign(downloadHref(f.id))
                      }
                      aria-label={canPreview(f.mime) ? `View ${f.name}` : `Download ${f.name}`}
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
                    </button>

                    <div className="card-body">
                      <span className="file-name" title={f.name}>
                        {f.name}
                      </span>
                      <span className="file-meta">
                        {formatSize(f.size)} · {formatWhen(f.createdAt)}
                      </span>
                      {f.description && (
                        <span className="file-desc" title={f.description}>
                          {f.description}
                        </span>
                      )}
                    </div>

                    <div className="card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => openEditor(f)}
                        aria-label={`Edit description of ${f.name}`}
                        title="Edit description"
                      >
                        📝
                      </button>
                      {canPreview(f.mime) && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setViewing(f)}
                          aria-label={`View ${f.name}`}
                          title="View"
                        >
                          👁️
                        </button>
                      )}
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
                  <span className="file-thumb">
                    {f.hasThumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumbHref(f.id, 128)}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.replaceWith(
                            document.createTextNode(iconFor(f.mime, f.name))
                          );
                        }}
                      />
                    ) : (
                      iconFor(f.mime, f.name)
                    )}
                  </span>
                  <span className="file-info">
                    <span className="file-name">{f.name}</span>
                    <span className="file-meta">
                      {formatSize(f.size)}
                      {f.uploader ? ` · ${f.uploader}` : ''} · {formatWhen(f.createdAt)}
                      {f.shared ? ' · 🌐 public link' : ''}
                    </span>
                    {f.description && (
                      <span className="file-desc" title={f.description}>
                        {f.description}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openEditor(f)}
                    aria-label={`Edit description of ${f.name}`}
                    title="Edit description"
                  >
                    📝
                  </button>
                  {canPreview(f.mime) && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setViewing(f)}
                      aria-label={`View ${f.name}`}
                      title="View"
                    >
                      👁️
                    </button>
                  )}
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
        </div>
      </div>

      {pending && (
        <div className="dialog" role="dialog" aria-modal="true">
          <div className="dialog-card">
            <h2>Add a description?</h2>
            <p className="muted dialog-sub">{pending.name}</p>
            <textarea
              autoFocus
              rows={3}
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              maxLength={500}
              placeholder="Describe this image…"
              disabled={preparing}
            />
            <label className="dialog-check">
              <input
                type="checkbox"
                checked={stampCaption}
                onChange={(e) => setStampCaption(e.target.checked)}
                disabled={preparing}
              />
              <span>Print it under the image as a caption</span>
            </label>
            <p className="dialog-note">
              The description is saved to Google Drive either way. With the box
              ticked, the uploaded image also carries the text in a band below it.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => confirmPending(false)}
                disabled={preparing}
              >
                No, upload as is
              </button>
              <button
                type="button"
                onClick={() => confirmPending(true)}
                disabled={preparing || !pendingText.trim()}
              >
                {preparing ? 'Preparing…' : 'Add description'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="dialog" role="dialog" aria-modal="true" onClick={() => setEditing(null)}>
          <form
            className="dialog-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveDescription}
          >
            <h2>Description</h2>
            <p className="muted dialog-sub">{editing.name}</p>
            <textarea
              autoFocus
              rows={4}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              maxLength={500}
              placeholder="Visible in Google Drive's file details"
            />
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" disabled={savingDesc}>
                {savingDesc ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
          <div
            className="viewer"
            role="dialog"
            aria-modal="true"
            aria-label={viewing.name}
            onClick={() => setViewing(null)}
          >
            <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
              <span className="viewer-name" title={viewing.name}>
                {viewing.name}
              </span>
              <span className="viewer-meta">{formatSize(viewing.size)}</span>
              <a
                className="icon-btn"
                href={downloadHref(viewing.id)}
                download={viewing.name}
                aria-label="Download"
                title="Download"
              >
                ⬇️
              </a>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setViewing(null)}
                aria-label="Close viewer"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Stop clicks on the media itself from closing the viewer. */}
            <div className="viewer-stage" onClick={(e) => e.stopPropagation()}>
              {viewing.mime.startsWith('image/') && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={viewHref(viewing.id)} alt={viewing.name} />
              )}
              {viewing.mime.startsWith('video/') && (
                <video src={viewHref(viewing.id)} controls autoPlay />
              )}
              {viewing.mime.startsWith('audio/') && (
                <audio src={viewHref(viewing.id)} controls autoPlay />
              )}
              {viewing.mime === 'application/pdf' && (
                <iframe src={viewHref(viewing.id)} title={viewing.name} />
              )}
            </div>
          </div>
        )}
    </Shell>
  );
}
