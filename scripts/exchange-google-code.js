/**
 * Fallback for get-google-refresh-token.js: exchange an authorisation code by
 * hand when the local callback server never received it (port 3000 was busy,
 * the browser opened on another machine, etc.).
 *
 *   node scripts/exchange-google-code.js "4/0A...."
 *
 * Codes are single-use and expire in roughly 10 minutes.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENV_PATH = path.join(process.cwd(), '.env');
const REDIRECT = 'http://localhost:3000/oauth2callback';

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

const writeEnvKey = (key, value) => {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
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

// Accept either a bare code or the whole callback URL pasted from the browser.
const raw = process.argv[2] || '';
if (!raw) {
  console.error('Usage: node scripts/exchange-google-code.js "<code or callback URL>"');
  process.exit(1);
}
let code = raw;
if (raw.includes('oauth2callback')) {
  const q = raw.slice(raw.indexOf('?') + 1);
  for (const pair of q.split('&')) {
    const [k, ...rest] = pair.split('=');
    if (k === 'code') code = decodeURIComponent(rest.join('='));
  }
}

const env = readEnv();
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

(async () => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.refresh_token) {
    console.error(`\nExchange failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
    if (data.error === 'invalid_grant') {
      console.error(
        'The code was already used or has expired. Re-run scripts/get-google-refresh-token.js\n' +
          'with port 3000 free so the callback is captured automatically.'
      );
    }
    process.exit(1);
  }

  writeEnvKey('GOOGLE_REFRESH_TOKEN', data.refresh_token);
  console.log('\n✅ GOOGLE_REFRESH_TOKEN written to .env');
  console.log(`   ${data.refresh_token.length} chars, scope: ${data.scope || '?'}`);
})();
