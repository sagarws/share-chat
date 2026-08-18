import { NextResponse } from 'next/server';
import { setPassword } from '../../../db';

export const runtime = 'nodejs';

// Gated on the client by localStorage.edit === 'true'; the server does not
// re-check auth here.
export async function POST(req) {
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
