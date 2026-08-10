'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Composer from './Composer';
import { renderMarkdown } from './markdown';
import db from './database/db.json';

const AUTH_KEY = 'chat-auth';
const SESSION_MS = 30 * 60 * 1000; // 30 minutes

const readAuth = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const clearAuth = () => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_KEY);
};

// True only if the stored password still matches and the session hasn't expired.
const isAuthValid = () => {
  const rec = readAuth();
  if (!rec || typeof rec !== 'object') return false;
  if (rec.pwd !== db.pwd) return false;
  if (typeof rec.ts !== 'number') return false;
  return Date.now() - rec.ts <= SESSION_MS;
};

// Keep in sync with the same-named constants in server.js.
const MAX_FILE_BYTES = 10000 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 4000;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

// WhatsApp-style circular progress ring shown while a file moves.
function ProgressRing({ value, size = 44 }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));

  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#fff"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function Attachment({ message: m }) {
  const busy = m.status === 'uploading' || m.status === 'downloading';
  const failed = m.status === 'failed';
  const percent = Math.round((m.progress || 0) * 100);
  const isImage = m.mime.startsWith('image/');

  const statusLine = failed
    ? 'Failed'
    : m.status === 'uploading'
      ? `Uploading · ${percent}%`
      : m.status === 'downloading'
        ? `Downloading · ${percent}%`
        : `${formatSize(m.size)} · download`;

  if (isImage) {
    // Receivers have no bytes until the transfer finishes, so show a placeholder.
    const body = m.url ? (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={m.url} alt={m.name} className={busy ? 'dimmed' : undefined} />
    ) : (
      <div className="image-placeholder" />
    );

    const media = (
      <div className="attachment-image">
        {body}
        {busy && (
          <span className="ring-overlay">
            <ProgressRing value={m.progress || 0} size={52} />
            <span className="ring-label">{percent}%</span>
          </span>
        )}
        {failed && <span className="ring-overlay failed-badge">!</span>}
      </div>
    );

    return (
      <>
        {m.url && !busy ? (
          <a href={m.url} download={m.name} className="attachment-link">
            {media}
          </a>
        ) : (
          media
        )}
        {busy && <div className="attachment-size">{statusLine}</div>}
      </>
    );
  }

  const card = (
    <div className={`attachment-file ${failed ? 'failed' : ''}`}>
      <span className="attachment-icon">
        {busy ? (
          <span className="ring-wrap">
            <ProgressRing value={m.progress || 0} size={34} />
            <span className="ring-label small">{percent}</span>
          </span>
        ) : failed ? (
          '⚠️'
        ) : (
          '📄'
        )}
      </span>
      <span className="attachment-meta">
        <span className="attachment-name">{m.name}</span>
        <span className="attachment-size">{statusLine}</span>
      </span>
    </div>
  );

  return m.url && !busy ? (
    <a href={m.url} download={m.name} className="attachment-link">
      {card}
    </a>
  ) : (
    card
  );
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const listRef = useRef(null);
  const urlsRef = useRef([]);
  const incomingRef = useRef(new Map());

  useEffect(() => {
    if (!joined) return;

    const socket = io({
      path: '/socket.io',
      query: { username },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('message', (msg) =>
      setMessages((prev) => [...prev, { ...msg, kind: 'message' }])
    );
    socket.on('system', (msg) =>
      setMessages((prev) => [...prev, { ...msg, kind: 'system' }])
    );

    socket.on('file-start', (msg) => {
      incomingRef.current.set(msg.id, { parts: [], received: 0 });
      setMessages((prev) => [
        ...prev,
        { ...msg, kind: 'file', status: 'downloading', progress: 0 },
      ]);
    });

    socket.on('file-chunk', ({ id, data }) => {
      const entry = incomingRef.current.get(id);
      if (!entry) return;

      entry.parts.push(data);
      entry.received += data.byteLength ?? data.length ?? 0;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, progress: m.size ? entry.received / m.size : 0 }
            : m
        )
      );
    });

    socket.on('file-end', ({ id }) => {
      const entry = incomingRef.current.get(id);
      if (!entry) return;
      incomingRef.current.delete(id);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const url = URL.createObjectURL(
            new Blob(entry.parts, { type: m.mime })
          );
          urlsRef.current.push(url);
          return { ...m, url, status: 'done', progress: 1 };
        })
      );
    });

    socket.on('file-abort', ({ id }) => {
      incomingRef.current.delete(id);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: 'failed' } : m))
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joined, username]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Drop everything the chat session owns and send the user back to the login
  // screen. Called on manual logout AND on session expiry.
  const logout = () => {
    clearAuth();
    setAuthed(false);
    setJoined(false);
    setUsername('');
    setMessages([]);
    setInput('');
    setFile(null);
    setError('');
    setPwdInput('');
    setPwdError('');
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  // Rehydrate a prior password unlock so a refresh doesn't ask again — but
  // only if the stored password still matches and the 30-min window is alive.
  useEffect(() => {
    if (isAuthValid()) setAuthed(true);
    else clearAuth();
  }, []);

  // While authed, re-check the stored pwd + timestamp on an interval and
  // whenever the tab regains focus. If either fails, purge and log out.
  useEffect(() => {
    if (!authed) return;
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
    // logout intentionally omitted — it only touches setState + refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (pwdInput === db.pwd) {
      window.localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({ pwd: pwdInput, ts: Date.now() })
      );
      setAuthed(true);
      setPwdError('');
      setPwdInput('');
    } else {
      setPwdError('Incorrect password.');
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setJoined(true);
  };

  const handlePickFile = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      setError(`File is too large (max ${formatSize(MAX_FILE_BYTES)}).`);
      return;
    }
    setError('');
    setFile(picked);
  };

  const handleSend = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!socketRef.current || sending) return;
    if (!isAuthValid()) {
      logout();
      return;
    }

    const text = input.trim();

    if (file) {
      const socket = socketRef.current;
      const outgoing = file;
      const mime = outgoing.type || 'application/octet-stream';

      setSending(true);
      setError('');

      let localId = null;
      try {
        const res = await socket.timeout(30000).emitWithAck('file-start', {
          name: outgoing.name,
          mime,
          size: outgoing.size,
          text,
        });

        if (!res?.ok) {
          setError(res?.error || 'Server rejected the file.');
          return;
        }

        // Clear the composer now that the transfer is accepted.
        localId = res.id;
        setFile(null);
        setInput('');

        // The sender already has the bytes, so preview locally at 0%.
        const url = URL.createObjectURL(outgoing);
        urlsRef.current.push(url);
        setMessages((prev) => [
          ...prev,
          {
            id: localId,
            kind: 'file',
            user: username,
            name: outgoing.name,
            mime,
            size: outgoing.size,
            text,
            ts: Date.now(),
            url,
            status: 'uploading',
            progress: 0,
          },
        ]);

        let sent = 0;
        for (let index = 0; sent < outgoing.size; index++) {
          const slice = outgoing.slice(sent, sent + CHUNK_BYTES);
          const data = await slice.arrayBuffer();

          const chunkRes = await socket
            .timeout(30000)
            .emitWithAck('file-chunk', { id: localId, index, data });
          if (!chunkRes?.ok) throw new Error(chunkRes?.error || 'Chunk rejected.');

          sent += data.byteLength;
          const progress = sent / outgoing.size;
          setMessages((prev) =>
            prev.map((m) => (m.id === localId ? { ...m, progress } : m))
          );
        }

        const endRes = await socket
          .timeout(30000)
          .emitWithAck('file-end', { id: localId });
        if (!endRes?.ok) throw new Error(endRes?.error || 'Transfer failed.');

        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId ? { ...m, status: 'done', progress: 1 } : m
          )
        );
      } catch (err) {
        setError(
          err?.message ||
            'Upload failed — the server never confirmed it. If you just changed server.js, restart the dev server.'
        );
        if (localId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m))
          );
        }
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text) return;
    socketRef.current.emit('message', { text });
    setInput('');
  };

  const formatTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!authed) {
    return (
      <div className="screen center">
        <form className="join-card" onSubmit={handleLogin}>
          <h1>Sign in</h1>
          <p className="muted">Enter the password to continue.</p>
          <input
            autoFocus
            type="password"
            placeholder="Password"
            value={pwdInput}
            onChange={(e) => {
              setPwdInput(e.target.value);
              if (pwdError) setPwdError('');
            }}
            maxLength={100}
          />
          {pwdError && <div className="composer-error">{pwdError}</div>}
          <button type="submit" disabled={!pwdInput}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="screen center">
        <form className="join-card" onSubmit={handleJoin}>
          <h1>Join Chat</h1>
          <p className="muted">Messages are kept in your browser only.</p>
          <input
            autoFocus
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={30}
          />
          <button type="submit" disabled={!username.trim()}>
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="header">
        <div>
          <strong>Chat</strong>
          <span className="muted"> · {username}</span>
        </div>
        <span className={`status ${connected ? 'on' : 'off'}`}>
          {connected ? 'online' : 'offline'}
        </span>
      </header>

      <main className="messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty muted">No messages yet. Say hi.</div>
        )}
        {messages.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="system muted">
              {m.text}
            </div>
          ) : (
            <div
              key={m.id}
              className={`bubble ${m.user === username ? 'mine' : 'theirs'}`}
            >
              {m.user !== username && <div className="who">{m.user}</div>}

              {m.kind === 'file' && <Attachment message={m} />}

              {m.text && (
                <div className="text md">{renderMarkdown(m.text)}</div>
              )}
              <div className="time">{formatTime(m.ts)}</div>
            </div>
          )
        )}
      </main>

      {error && <div className="composer-error">{error}</div>}

      {file && (
        <div className="pending-file">
          <span className="attachment-icon">
            {file.type.startsWith('image/') ? '🖼️' : '📄'}
          </span>
          <span className="attachment-meta">
            <span className="attachment-name">{file.name}</span>
            <span className="attachment-size">{formatSize(file.size)}</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        onPickFile={handlePickFile}
        disabled={!connected}
        sending={sending}
        hasAttachment={Boolean(file)}
        placeholder={file ? 'Add a caption (optional)' : 'Type a message'}
        maxLength={MAX_TEXT_LENGTH}
      />
    </div>
  );
}
