import { NextResponse } from 'next/server';
import { removeFolder, listFolders, getSelectedFolder } from '../../../../db';
import { resolveDrive } from '../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Removes the folder from the app's list only. The folder and its files stay
// in Google Drive untouched.
export async function DELETE(req, { params }) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  if (!removeFolder(params.id, ctx.accountId)) {
    return NextResponse.json({ ok: false, error: 'Unknown folder.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    folders: listFolders(ctx.accountId),
    selected: getSelectedFolder(ctx.accountId),
  });
}
