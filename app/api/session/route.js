import { NextResponse } from 'next/server';
import { verifyToken } from '../../../db';

export const runtime = 'nodejs';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

export async function GET(req) {
  const info = verifyToken(readToken(req));
  if (!info) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, expiresAt: info.expiresAt });
}
