import { NextResponse } from 'next/server';
import { verifyToken, getFile, removeFile } from '../../../../db';
import { downloadFile, deleteFile } from '../../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Downloads are plain <a> navigations, which cannot set an Authorization
// header — so the token may also arrive as ?token=. Both paths hit the same
// verifyToken() the socket handshake uses.
const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) return value;
  return new URL(req.url).searchParams.get('token') || '';
};

// RFC 5987 so non-ASCII filenames survive the Content-Disposition header.
const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export async function GET(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const row = getFile(params.id);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
  }

  try {
    const upstream = await downloadFile(row.storage_key);
    return new Response(upstream.body, {
      headers: {
        'Content-Type': row.mime,
        'Content-Length': String(row.size),
        'Content-Disposition': contentDisposition(row.name),
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Download failed.' },
      { status: 502 }
    );
  }
}

export async function DELETE(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const row = getFile(params.id);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
  }

  try {
    await deleteFile(row.storage_key);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Drive delete failed.' },
      { status: 502 }
    );
  }

  // Only drop the row once Drive confirmed, so we never orphan a Drive file.
  removeFile(row.id);
  return NextResponse.json({ ok: true });
}
