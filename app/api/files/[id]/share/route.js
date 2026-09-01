import { NextResponse } from 'next/server';
import { verifyToken } from '../../../../../db';
import { shareFile } from '../../../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Grants "anyone with the link can view" on the Drive file and returns that
// link. Anyone signed in can do this, and the resulting URL works outside the
// app's password gate — see the note in drive.js.
export async function POST(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const link = await shareFile(params.id);
    if (!link) {
      return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not create a share link.' },
      { status: 502 }
    );
  }
}
