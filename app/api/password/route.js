import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

// Writes the new password back to app/database/db.json.
// NOTE: no auth — gated only by the client-side `edit` flag in localStorage.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const pwd = typeof body?.pwd === 'string' ? body.pwd.trim() : '';
  if (!pwd) {
    return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 });
  }
  if (pwd.length > 100) {
    return NextResponse.json({ ok: false, error: 'Password is too long.' }, { status: 400 });
  }

  const file = path.join(process.cwd(), 'app', 'database', 'db.json');
  try {
    let current = {};
    try {
      const raw = await fs.readFile(file, 'utf8');
      current = raw.trim() ? JSON.parse(raw) : {};
    } catch (readErr) {
      if (readErr.code !== 'ENOENT') throw readErr;
    }
    current.pwd = pwd;
    await fs.writeFile(file, JSON.stringify(current, null, 4) + '\n', 'utf8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Write failed.' },
      { status: 500 }
    );
  }
}
