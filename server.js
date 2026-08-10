const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT, 10) || 3000;
const MAX_FILE_BYTES = 10000 * 1024 * 1024;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
    maxHttpBufferSize: MAX_FILE_BYTES + 1024 * 1024,
  });

  io.on('connection', (socket) => {
    const rawName = socket.handshake.query.username;
    const username = (typeof rawName === 'string' ? rawName : '')
      .trim()
      .slice(0, 30) || 'Anonymous';

    socket.broadcast.emit('system', {
      id: `sys-${Date.now()}-${socket.id}`,
      text: `${username} joined`,
      ts: Date.now(),
    });

    socket.on('message', (payload) => {
      if (!payload || typeof payload.text !== 'string') return;
      const text = payload.text.trim().slice(0, 1000);
      if (!text) return;

      io.emit('message', {
        id: `${socket.id}-${Date.now()}`,
        user: username,
        text,
        ts: Date.now(),
      });
    });

    socket.on('file', (payload, ack) => {
      const fail = (error) => {
        if (typeof ack === 'function') ack({ ok: false, error });
      };

      if (!payload || typeof payload.name !== 'string') {
        return fail('Invalid file payload.');
      }

      const raw = payload.data;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : null;
      if (!buf || buf.length === 0) return fail('File is empty or unreadable.');
      if (buf.length > MAX_FILE_BYTES) return fail('File is too large.');

      const name = payload.name.trim().slice(0, 120) || 'file';
      const mime =
        typeof payload.mime === 'string' && payload.mime
          ? payload.mime.slice(0, 100)
          : 'application/octet-stream';
      const text =
        typeof payload.text === 'string' ? payload.text.trim().slice(0, 1000) : '';

      io.emit('file', {
        id: `${socket.id}-${Date.now()}`,
        user: username,
        name,
        mime,
        size: buf.length,
        data: buf,
        text,
        ts: Date.now(),
      });

      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', () => {
      socket.broadcast.emit('system', {
        id: `sys-${Date.now()}-${socket.id}`,
        text: `${username} left`,
        ts: Date.now(),
      });
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
