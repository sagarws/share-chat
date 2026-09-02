import { NextResponse } from 'next/server';
import { verifyToken } from '../../../../db';
import { isConfigured, createFolder } from '../../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Creates a real folder in Drive under `parentId`. Folders made this way are
// app-created, so they are visible to the drive.file scope and appear in the
// tree — unlike a folder made by hand in the Drive web UI.
export async function POST(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: 'Google Drive is not configured.' }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  const parentId = typeof body?.parentId === 'string' ? body.parentId.trim() : '';
  if (!name) {
    return NextResponse.json({ ok: false, error: 'Folder name is required.' }, { status: 400 });
  }
  if (!parentId) {
    return NextResponse.json({ ok: false, error: 'Parent folder is required.' }, { status: 400 });
  }

  try {
    const folder = await createFolder(name, parentId);
    return NextResponse.json({ ok: true, folder });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not create the folder.' },
      { status: 502 }
    );
  }
}
