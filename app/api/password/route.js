import { NextResponse } from 'next/server';
import { setPassword, verifyToken } from '../../../db';

export const runtime = 'nodejs';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Change the stored password. Requires a valid session token (i.e. the caller
// has already logged in). No previous-password prompt, per product spec.
export async function POST(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json(
      { ok: false, error: 'Not authenticated.' },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON.' },
      { status: 400 }
    );
  }

  const pwd = typeof body?.pwd === 'string' ? body.pwd.trim() : '';
  if (!pwd) {
    return NextResponse.json(
      { ok: false, error: 'Password is required.' },
      { status: 400 }
    );
  }
  if (pwd.length > 100) {
    return NextResponse.json(
      { ok: false, error: 'Password is too long.' },
      { status: 400 }
    );
  }

  try {
    setPassword(pwd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Write failed.' },
      { status: 500 }
    );
  }
}
