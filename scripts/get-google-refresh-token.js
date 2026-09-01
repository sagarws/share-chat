/**
 * One-off helper: mint a Google Drive refresh token for this app.
 *
 *   node scripts/get-google-refresh-token.js
 *
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env, opens the consent
 * screen in your browser, catches the redirect on localhost:3000, exchanges
 * the code for a refresh token, and writes it back into .env.
 *
 * Stop the dev server first — this needs port 3000.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const ENV_PATH = path.join(process.cwd(), '.env');
const REDIRECT = 'http://localhost:3000/oauth2callback';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const readEnv = () => {
  const out = {};
  if (!fs.existsSync(ENV_PATH)) return out;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
};

// Rewrite one key in .env in place, preserving comments and ordering.
const writeEnvKey = (key, value) => {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8').split('\n')
    : [];
  let found = false;
  const next = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, next.join('\n'));
};

const env = readEnv();
const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent are what make Google hand back a refresh_token.
    access_type: 'offline',
    prompt: 'consent',
  });

const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">${body}</body>`);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname !== '/oauth2callback') return reply(res, 404, 'Not found');

  const err = url.searchParams.get('error');
  if (err) {
    reply(res, 400, `<h2>Denied</h2><p>${err}</p>`);
    console.error(`\nGoogle returned: ${err}`);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) return reply(res, 400, '<h2>No code in callback</h2>');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();

    if (!tokenRes.ok || !data.refresh_token) {
      const detail = data.error_description || data.error || 'no refresh_token returned';
      reply(res, 500, `<h2>Token exchange failed</h2><pre>${detail}</pre>`);
      console.error(`\nToken exchange failed: ${detail}`);
      console.error(JSON.stringify(data, null, 2));
      server.close();
      process.exit(1);
    }

    writeEnvKey('GOOGLE_REFRESH_TOKEN', data.refresh_token);
    reply(res, 200, '<h2>Done ✅</h2><p>Refresh token saved to .env. You can close this tab.</p>');
    console.log('\n✅ GOOGLE_REFRESH_TOKEN written to .env');
    console.log(`   ${data.refresh_token.slice(0, 12)}… (${data.refresh_token.length} chars)`);
    server.close();
  } catch (e) {
    reply(res, 500, `<h2>Error</h2><pre>${e.message}</pre>`);
    console.error(e);
    server.close();
    process.exit(1);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port 3000 is busy — stop `npm run dev` and try again.');
    process.exit(1);
  }
  throw e;
});

server.listen(3000, () => {
  console.log('\nOpen this URL if the browser did not:\n');
  console.log(authUrl + '\n');
  const open =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${open} "${authUrl}"`);
});
