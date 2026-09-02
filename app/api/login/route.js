import { NextResponse } from 'next/server';
import { getPassword, signToken, SESSION_MS, PERSIST_MS } from '../../../db';

export const runtime = 'nodejs';

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

  const pwd = typeof body?.pwd === 'string' ? body.pwd : '';
  if (!pwd) {
    return NextResponse.json(
      { ok: false, error: 'Password is required.' },
      { status: 400 }
    );
  }

  if (pwd !== getPassword()) {
    return NextResponse.json(
      { ok: false, error: 'Incorrect password.' },
      { status: 401 }
    );
  }

  // Edit-mode clients ask for a session that does not expire. The lifetime is
  // signed into the token, so this is the only place it can be granted.
  const ttl = body?.persist === true ? PERSIST_MS : SESSION_MS;

  const { token, expiresAt } = signToken(Date.now(), ttl);
  return NextResponse.json({ ok: true, token, expiresAt });
}
