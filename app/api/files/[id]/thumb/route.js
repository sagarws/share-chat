import { NextResponse } from 'next/server';
import { resolveDrive } from '../../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// <img src> cannot set an Authorization header, so the token comes as ?token=
// (and the Drive account key as ?account=) exactly like the download route.
export async function GET(req, { params }) {
  const ctx = resolveDrive(req, { query: true });
  if (ctx.error) return ctx.error;
  try {
    const size = Number(new URL(req.url).searchParams.get('s')) || 400;
    const upstream = await ctx.drive.getThumbnail(params.id, Math.min(Math.max(size, 64), 1600));
    if (!upstream) {
      return NextResponse.json({ ok: false, error: 'No preview.' }, { status: 404 });
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        // Thumbnails are immutable for a given file; cache in the browser only.
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'No preview.' }, { status: 404 });
  }
}
