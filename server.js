const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT, 10) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
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
