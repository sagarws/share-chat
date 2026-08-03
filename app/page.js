'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export default function Home() {
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const listRef = useRef(null);

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

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joined, username]);

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

  const handleSend = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socketRef.current) return;
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
              <div className="text">{m.text}</div>
              <div className="time">{formatTime(m.ts)}</div>
            </div>
          )
        )}
      </main>

      <form className="composer" onSubmit={handleSend}>
        <input
          placeholder="Type a message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
        />
        <button type="submit" disabled={!input.trim() || !connected}>
          Send
        </button>
      </form>
    </div>
  );
}
