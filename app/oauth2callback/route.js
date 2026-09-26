import { NextResponse } from 'next/server';
import { verifyState, saveAccount, signAccountKey } from '../../db';
import { exchangeCode, fetchUserInfo, createClient } from '../../drive';
import { appOrigin, redirectUri, STATE_COOKIE } from '../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Step 2: Google sends the browser back here after the user clicks Allow.
// Lives at /oauth2callback (not under /api) because that is the redirect URI
// already registered on the OAuth client for local development.

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

const backToDrive = (req, error) => {
  const url = new URL('/drive', appOrigin(req));
  if (error) url.searchParams.set('error', error);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
};

export async function GET(req) {
  const url = new URL(req.url);

  const denied = url.searchParams.get('error');
  if (denied) {
    return backToDrive(
      req,
      denied === 'access_denied' ? 'Google Drive access was not allowed.' : `Google said: ${denied}`
    );
  }

  const state = verifyState(url.searchParams.get('state'));
  const nonce = req.cookies.get(STATE_COOKIE)?.value || '';
  if (!state || !nonce || state.n !== nonce || Date.now() - Number(state.t) > STATE_MAX_AGE_MS) {
    return backToDrive(req, 'That sign-in link expired. Please try connecting again.');
  }

  const code = url.searchParams.get('code');
  if (!code) return backToDrive(req, 'Google did not return a sign-in code.');

  let key;
  try {
    const tokens = await exchangeCode({ code, redirectUri: redirectUri(req) });
    const user = await fetchUserInfo(tokens.accessToken);
    // Uploads land in a "Share Chat" folder in the user's own Drive.
    const folder = await createClient(tokens.refreshToken).ensureAppFolder();
    const account = saveAccount({
      ...user,
      refreshToken: tokens.refreshToken,
      rootFolderId: folder.id,
    });
    key = signAccountKey(account.id);
  } catch (err) {
    return backToDrive(req, err?.message || 'Could not connect Google Drive.');
  }

  // The account key belongs in this browser's localStorage, next to the
  // session token, so hand it over with a tiny page that stores it and moves
  // on. It never appears in a URL or the browser history.
  const html = `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:16px system-ui;padding:3rem">Connecting your Google Drive…
<script>
try { localStorage.setItem('drive-account', ${JSON.stringify(key)}); } catch (e) {}
location.replace('/drive?connected=1');
</script>`;
  const res = new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
