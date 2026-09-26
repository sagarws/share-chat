import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyToken, signState } from '../../../../db';
import { isOAuthConfigured, buildAuthUrl } from '../../../../drive';
import { appOrigin, redirectUri, STATE_COOKIE } from '../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 1 of connecting a user's own Google Drive. The /drive page navigates
// here (a plain navigation, so the session token rides as ?token=) and we
// bounce the browser to Google's consent screen.
export async function GET(req) {
  const url = new URL(req.url);
  if (!verifyToken(url.searchParams.get('token') || '')) {
    return NextResponse.redirect(new URL('/', appOrigin(req)));
  }
  if (!isOAuthConfigured()) {
    const back = new URL('/drive', appOrigin(req));
    back.searchParams.set('error', 'Google sign-in is not set up on this server.');
    return NextResponse.redirect(back);
  }

  // The nonce lives both in the signed state and in a short-lived cookie, so a
  // callback is only accepted in the browser that started it.
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = signState({ n: nonce, t: Date.now() });

  const res = NextResponse.redirect(buildAuthUrl({ redirectUri: redirectUri(req), state }));
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appOrigin(req).startsWith('https:'),
    path: '/',
    maxAge: 10 * 60,
  });
  return res;
}
