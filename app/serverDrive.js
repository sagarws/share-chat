import { NextResponse } from 'next/server';
import { verifyToken, accountFromKey } from '../db';
import { isConfigured, createClient, sharedClient } from '../drive';

// Server-only helper shared by every Drive-backed route: checks the session and
// picks whose Google Drive the request works on.
//
// A browser that connected its own Drive on the /drive page sends its account
// key as the X-Drive-Account header (or ?account= on plain <a>/<img> URLs,
// which cannot set headers). Without one, the request uses the shared Drive
// from GOOGLE_REFRESH_TOKEN, exactly as before.

const readBearer = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value || '' : '';
};

const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });

// 409 plus `reconnect: true` tells the client to drop its stored account key
// and send the user to the Google Drive page.
const reconnect = (error) =>
  NextResponse.json(
    {
      ok: false,
      reconnect: true,
      error:
        error ||
        'Your Google Drive connection is no longer valid. Reconnect it on the Google Drive page.',
    },
    { status: 409 }
  );

/**
 * @param {Request} req
 * @param {object}  [opts]
 * @param {boolean} [opts.query]  also accept ?token= and ?account= (downloads, thumbnails)
 * @returns {{ error: Response } | { accountId: string, account: object|null, drive: object, configured: boolean }}
 */
export function resolveDrive(req, { query = false } = {}) {
  const params = query ? new URL(req.url).searchParams : null;

  const token = readBearer(req) || params?.get('token') || '';
  if (!verifyToken(token)) return { error: unauthorized() };

  const key = req.headers.get('x-drive-account') || params?.get('account') || '';
  if (key) {
    const account = accountFromKey(key);
    if (!account) return { error: reconnect() };
    return {
      accountId: account.id,
      account,
      drive: createClient(account.refreshToken),
      configured: true,
    };
  }

  return { accountId: '', account: null, drive: sharedClient(), configured: isConfigured() };
}

/** Turn a thrown Drive error into a response, flagging revoked connections. */
export function driveError(err, fallback, status = 502) {
  if (err?.code === 'DRIVE_RECONNECT') return reconnect(err.message);
  return NextResponse.json({ ok: false, error: err?.message || fallback }, { status });
}

/**
 * The OAuth redirect URI for this deployment: <origin>/oauth2callback.
 *
 * It must match, character for character, one of the "Authorized redirect
 * URIs" on the OAuth client in Google Cloud. `/oauth2callback` is the path the
 * refresh-token script already registered for http://localhost:3000, so local
 * development works as-is; a deployed site needs its own origin added there.
 *
 * APP_URL (e.g. https://share-chat.onrender.com) pins the origin; otherwise it
 * is taken from the request, honouring the proxy headers Render sets.
 */
export function redirectUri(req) {
  return `${appOrigin(req)}/oauth2callback`;
}

/** Public origin of this site, as the browser sees it. */
export function appOrigin(req) {
  const pinned = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (pinned) return pinned;

  const url = new URL(req.url);
  const proto = (req.headers.get('x-forwarded-proto') || url.protocol.replace(':', ''))
    .split(',')[0]
    .trim();
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host)
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

/** Cookie that ties the OAuth round trip to the browser that started it. */
export const STATE_COOKIE = 'gdrive_oauth_nonce';
