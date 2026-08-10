import { NextResponse } from 'next/server';
import { getPassword, signToken } from '../../../db';

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

  const { token, expiresAt } = signToken();
  return NextResponse.json({ ok: true, token, expiresAt });
}
