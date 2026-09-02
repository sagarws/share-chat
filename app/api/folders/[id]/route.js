import { NextResponse } from 'next/server';
import { verifyToken, removeFolder, listFolders, getSelectedFolder } from '../../../../db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Removes the folder from the app's list only. The folder and its files stay
// in Google Drive untouched.
export async function DELETE(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!removeFolder(params.id)) {
    return NextResponse.json({ ok: false, error: 'Unknown folder.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    folders: listFolders(),
    selected: getSelectedFolder(),
  });
}
