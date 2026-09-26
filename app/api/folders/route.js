import { NextResponse } from 'next/server';
import { listFolders, addFolder, getSelectedFolder, setSelectedFolder } from '../../../db';
import { resolveDrive } from '../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  return NextResponse.json({
    ok: true,
    folders: listFolders(ctx.accountId),
    selected: getSelectedFolder(ctx.accountId),
  });
}

// Register a Drive folder. The id cannot be validated up front: under the
// drive.file scope Drive will not confirm a folder this app did not create,
// so a wrong id only shows up as a clear error on the first listing or upload.
export async function POST(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Folder id is required.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ ok: false, error: 'Folder name is required.' }, { status: 400 });
  }
  // Accept a pasted Drive URL as well as a bare id.
  const match = id.match(/\/folders\/([A-Za-z0-9_-]+)/);
  const folderId = match ? match[1] : id;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json(
      { ok: false, error: 'That does not look like a Drive folder id.' },
      { status: 400 }
    );
  }

  addFolder(folderId, name, ctx.accountId);
  // First folder registered becomes the default destination.
  if (!getSelectedFolder(ctx.accountId)) setSelectedFolder(folderId, ctx.accountId);

  return NextResponse.json({
    ok: true,
    folders: listFolders(ctx.accountId),
    selected: getSelectedFolder(ctx.accountId),
  });
}

// Change the default destination folder, remembered for next time.
export async function PUT(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const id = typeof body?.selected === 'string' ? body.selected.trim() : '';
  if (!setSelectedFolder(id, ctx.accountId)) {
    return NextResponse.json({ ok: false, error: 'Unknown folder.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, selected: getSelectedFolder(ctx.accountId) });
}
