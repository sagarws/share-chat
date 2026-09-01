import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifyToken, addFile, listFiles } from '../../../db';
import { isConfigured, uploadFile } from '../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 100 * 1024 * 1024;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

const publicRow = (row) => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  size: row.size,
  uploader: row.uploader,
  createdAt: row.created_at,
});

export async function GET(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    return NextResponse.json({
      ok: true,
      configured: isConfigured(),
      maxBytes: MAX_UPLOAD_BYTES,
      files: listFiles().map(publicRow),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not read files.' },
      { status: 500 }
    );
  }
}

// Upload. The file arrives as the raw request body (no multipart) with its
// metadata in headers, so the bytes stream straight through to Drive instead
// of being buffered in memory.
export async function POST(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Google Drive is not configured yet. Run scripts/get-google-refresh-token.js ' +
          'and restart the server.',
      },
      { status: 503 }
    );
  }

  const decode = (v) => {
    try {
      return decodeURIComponent(v || '');
    } catch {
      return '';
    }
  };

  const name = decode(req.headers.get('x-file-name')).trim().slice(0, 200) || 'file';
  const mime =
    (req.headers.get('x-file-type') || '').slice(0, 100) || 'application/octet-stream';
  const uploader = decode(req.headers.get('x-uploader')).trim().slice(0, 30);

  // Content-Length is set by the browser and is what Drive must agree with.
  const size = Number(req.headers.get('content-length'));
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: 'File is empty.' }, { status: 400 });
  }
  if (size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File is too large (max ${formatSize(MAX_UPLOAD_BYTES)}).` },
      { status: 413 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ ok: false, error: 'No file body.' }, { status: 400 });
  }

  try {
    const driveId = await uploadFile({ name, mime, size, body: req.body });
    const row = {
      id: crypto.randomUUID(),
      name,
      mime,
      size,
      uploader,
      storage_key: driveId,
      created_at: Date.now(),
    };
    addFile(row);
    return NextResponse.json({ ok: true, file: publicRow(row) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Upload failed.' },
      { status: 502 }
    );
  }
}
