import { NextResponse } from 'next/server';
import { verifyToken } from '../../../../../db';
import { getThumbnail } from '../../../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// <img src> cannot set an Authorization header, so the token comes as ?token=
// exactly like the download route.
const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) return value;
  return new URL(req.url).searchParams.get('token') || '';
};

export async function GET(req, { params }) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const size = Number(new URL(req.url).searchParams.get('s')) || 400;
    const upstream = await getThumbnail(params.id, Math.min(Math.max(size, 64), 1600));
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
