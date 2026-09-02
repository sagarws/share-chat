import { NextResponse } from 'next/server';
import { verifyToken } from '../../../../db';
import { getFileMeta, downloadFile, deleteFile, updateDescription } from '../../../../drive';

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
// `inline` is what lets the in-app viewer render a PDF or video in place —
// with "attachment" the browser downloads it instead of displaying it.
const contentDisposition = (name, inline) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

// params.id is the Drive file id — there is no local row to look up. Access is
// still gated: the token is checked first, and the drive.file scope means the
// app can only reach files it created in the first place.
export async function GET(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const meta = await getFileMeta(params.id);
    if (!meta) {
      return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
    }

    const inline = new URL(req.url).searchParams.has('inline');
    const upstream = await downloadFile(params.id);
    const headers = {
      'Content-Type': meta.mime,
      'Content-Disposition': contentDisposition(meta.name, inline),
      'Cache-Control': 'private, max-age=0, no-store',
    };
    if (meta.size > 0) headers['Content-Length'] = String(meta.size);

    return new Response(upstream.body, { headers });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Download failed.' },
      { status: 502 }
    );
  }
}

// Edit the Drive description of an existing file.
export async function PATCH(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, 500) : '';

  try {
    const saved = await updateDescription(params.id, description);
    if (saved === null) {
      return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, description: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not save the description.' },
      { status: 502 }
    );
  }
}

export async function DELETE(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    await deleteFile(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Delete failed.' },
      { status: 502 }
    );
  }
}
