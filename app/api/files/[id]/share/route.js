import { NextResponse } from 'next/server';
import { resolveDrive, driveError } from '../../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Grants "anyone with the link can view" on the Drive file and returns that
// link. Anyone signed in can do this, and the resulting URL works outside the
// app's password gate — see the note in drive.js.
export async function POST(req, { params }) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  try {
    const link = await ctx.drive.shareFile(params.id);
    if (!link) {
      return NextResponse.json({ ok: false, error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    return driveError(err, 'Could not create a share link.');
  }
}
