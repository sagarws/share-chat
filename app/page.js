'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Home() {
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
  const fileInputRef = useRef(null);
  const urlsRef = useRef([]);

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

    socket.on('file', (msg) => {
      const blob = new Blob([msg.data], { type: msg.mime });
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      setMessages((prev) => [...prev, { ...msg, kind: 'file', url }]);
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
    e.preventDefault();
    if (!socketRef.current || sending) return;

    const text = input.trim();

    if (file) {
      setSending(true);
      try {
        const data = await file.arrayBuffer();
        const res = await socketRef.current.timeout(30000).emitWithAck('file', {
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          data,
          text,
        });

        if (!res?.ok) {
          setError(res?.error || 'Server rejected the file.');
          return;
        }

        setFile(null);
        setInput('');
        setError('');
      } catch {
        setError(
          'Upload failed — the server never confirmed it. If you just changed server.js, restart the dev server.'
        );
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

              {m.kind === 'file' &&
                (m.mime.startsWith('image/') ? (
                  <a href={m.url} download={m.name} className="attachment-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.name} />
                  </a>
                ) : (
                  <a href={m.url} download={m.name} className="attachment-file">
                    <span className="attachment-icon">📄</span>
                    <span className="attachment-meta">
                      <span className="attachment-name">{m.name}</span>
                      <span className="attachment-size">
                        {formatSize(m.size)} · download
                      </span>
                    </span>
                  </a>
                ))}

              {m.text && <div className="text">{m.text}</div>}
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

      <form className="composer" onSubmit={handleSend}>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handlePickFile}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected || sending}
          aria-label="Attach file"
          title="Attach file"
        >
          📎
        </button>
        <input
          placeholder={file ? 'Add a caption (optional)' : 'Type a message'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
        />
        <button
          type="submit"
          disabled={(!input.trim() && !file) || !connected || sending}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
