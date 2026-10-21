const { createServer } = require('http');
const net = require('net');
const os = require('os');
const { loadEnvConfig } = require('@next/env');
const next = require('next');
const { Server } = require('socket.io');
const { verifyToken, addInstallerCleanup, listInstallerCleanups } = require('./db');

const dev = process.env.NODE_ENV !== 'production';
// Load .env now so PORT is read from it; Next would otherwise load it only
// after the port has already been chosen.
loadEnvConfig(process.cwd(), dev);

const hostname = '0.0.0.0';
const preferredPort = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_TRIES = 20;
const MAX_FILE_BYTES = 1000000 * 1024 * 1024;
const MAX_CHUNK_BYTES = 51200000 * 1024;
const MAX_CONCURRENT_TRANSFERS = 4000;

// Resolve to `port` if it can be bound, otherwise try the ports after it.
function findFreePort(port, triesLeft = MAX_PORT_TRIES) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && triesLeft > 1) {
        resolve(findFreePort(port + 1, triesLeft - 1));
      } else {
        reject(err);
      }
    });
    probe.once('listening', () => probe.close(() => resolve(port)));
    probe.listen(port, hostname);
  });
}

findFreePort(preferredPort).then((port) => {
  if (port !== preferredPort) {
    console.log(`> Port ${preferredPort} is in use, using ${port} instead`);
  }

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  return app.prepare().then(() => startServer(handle, port));
});

// --- TrackVid CMS installer cleanup log ---------------------------------------
//
// POST /api/installer-cleanup  — the CMS desktop app reports how many old
//   installers it deleted from Downloads on launch.
// GET  /api/installer-cleanup  — every record, plus per-company totals.
//
// PUBLIC, by the owner's choice: no key on either route. Anyone with the URL
// can add a row or read the whole list, company names included.

const CLEANUP_PATH = '/api/installer-cleanup';
const MAX_BODY_BYTES = 10 * 1024;

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });

async function handleInstallerCleanup(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ...listInstallerCleanups() });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }

    const companyName =
      typeof body.companyName === 'string' ? body.companyName.trim().slice(0, 200) : '';
    const deletedCount = Number(body.deletedCount);

    if (!companyName) return sendJson(res, 400, { ok: false, error: 'companyName is required' });
    if (!Number.isInteger(deletedCount) || deletedCount <= 0 || deletedCount > 10000) {
      return sendJson(res, 400, { ok: false, error: 'deletedCount must be a whole number above 0' });
    }

    return sendJson(res, 201, { ok: true, record: addInstallerCleanup(companyName, deletedCount) });
  }

  res.setHeader('Allow', 'GET, POST');
  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}

function startServer(handle, port) {
  const httpServer = createServer((req, res) => {
    if (req.url.split('?')[0] === CLEANUP_PATH) {
      return handleInstallerCleanup(req, res).catch((error) => {
        console.error('installer-cleanup failed', error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Server error' });
      });
    }
    return handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
    // Files stream in chunks now, so a frame only ever needs to hold one chunk.
    maxHttpBufferSize: MAX_CHUNK_BYTES * 2,
  });

  // Reject sockets whose handshake doesn't carry a valid, unexpired token.
  // The token is minted by POST /api/login and stored in the client's
  // localStorage. Without this, a hostile client could skip the password
  // screen and connect directly.
  io.use((socket, nextFn) => {
    const token =
      socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!verifyToken(token)) {
      return nextFn(new Error('unauthorized'));
    }
    nextFn();
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
      const text = payload.text.trim().slice(0, 4000);
      if (!text) return;

      io.emit('message', {
        id: `${socket.id}-${Date.now()}`,
        user: username,
        text,
        ts: Date.now(),
      });
    });

    // In-flight chunked transfers started by this socket, keyed by transfer id.
    const transfers = new Map();
    let transferSeq = 0;

    socket.on('file-start', (meta, ack) => {
      const fail = (error) => {
        if (typeof ack === 'function') ack({ ok: false, error });
      };

      if (!meta || typeof meta.name !== 'string') {
        return fail('Invalid file metadata.');
      }

      const size = Number(meta.size);
      if (!Number.isFinite(size) || size <= 0) return fail('File is empty.');
      if (size > MAX_FILE_BYTES) return fail('File is too large.');
      if (transfers.size >= MAX_CONCURRENT_TRANSFERS) {
        return fail('Too many uploads at once.');
      }

      const id = `${socket.id}-${Date.now()}-${transferSeq++}`;
      const info = {
        id,
        name: meta.name.trim().slice(0, 120) || 'file',
        mime:
          typeof meta.mime === 'string' && meta.mime
            ? meta.mime.slice(0, 100)
            : 'application/octet-stream',
        size,
        received: 0,
        text:
          typeof meta.text === 'string' ? meta.text.trim().slice(0, 4000) : '',
      };
      transfers.set(id, info);

      socket.broadcast.emit('file-start', {
        id,
        user: username,
        name: info.name,
        mime: info.mime,
        size: info.size,
        text: info.text,
        ts: Date.now(),
      });

      if (typeof ack === 'function') ack({ ok: true, id });
    });

    socket.on('file-chunk', (payload, ack) => {
      const fail = (error) => {
        if (typeof ack === 'function') ack({ ok: false, error });
      };

      const info = payload && transfers.get(payload.id);
      if (!info) return fail('Unknown transfer.');

      const raw = payload.data;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : null;
      if (!buf || buf.length === 0) return fail('Empty chunk.');
      if (buf.length > MAX_CHUNK_BYTES) {
        transfers.delete(info.id);
        socket.broadcast.emit('file-abort', { id: info.id });
        return fail('Chunk too large.');
      }

      info.received += buf.length;
      if (info.received > info.size) {
        transfers.delete(info.id);
        socket.broadcast.emit('file-abort', { id: info.id });
        return fail('File exceeded its declared size.');
      }

      socket.broadcast.emit('file-chunk', {
        id: info.id,
        index: Number(payload.index) || 0,
        data: buf,
      });

      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('file-end', (payload, ack) => {
      const fail = (error) => {
        if (typeof ack === 'function') ack({ ok: false, error });
      };

      const info = payload && transfers.get(payload.id);
      if (!info) return fail('Unknown transfer.');
      transfers.delete(info.id);

      if (info.received !== info.size) {
        socket.broadcast.emit('file-abort', { id: info.id });
        return fail('Transfer was incomplete.');
      }

      socket.broadcast.emit('file-end', { id: info.id });
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', () => {
      // Tell receivers to drop any half-streamed files from this sender.
      for (const id of transfers.keys()) {
        socket.broadcast.emit('file-abort', { id });
      }
      transfers.clear();

      socket.broadcast.emit('system', {
        id: `sys-${Date.now()}-${socket.id}`,
        text: `${username} left`,
        ts: Date.now(),
      });
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log('> Ready');
    console.log(`  Local:   http://localhost:${port}`);
    for (const ip of lanAddresses()) {
      console.log(`  Network: http://${ip}:${port}`);
    }
  });
}

// IPv4 addresses other devices on the same network can reach this machine at.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}
