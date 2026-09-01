# Share Chat — working notes

Password-gated realtime chat (Socket.IO on a custom `server.js`) plus a File
Share page backed by Google Drive. Next.js 14 App Router, SQLite via
`better-sqlite3` for settings only.

## Always verify with a clean production build

**After any change, before reporting it as done, run the build the way Render
does — from a clean slate:**

```bash
nvm use 22
rm -rf .next data
npm run build
```

A passing `npm run dev` proves nothing about the deploy. Dev mode compiles
routes lazily, one at a time, in a single process. `next build` imports **every
route module in several parallel workers** to collect page data, on a host with
no `data/` directory. That difference is what breaks production builds while
local dev looks fine.

### The specific failure to watch for

`Failed to collect page data for /api/files` with `code: 'SQLITE_BUSY'`.

Cause: module-level side effects. `db.js` used to open the database, switch it
to WAL and write seed rows at *import* time, so every build worker raced for the
same file and the same exclusive lock. It now opens lazily on first use.

**So: never do I/O at module scope in anything a route imports** — no opening
databases, creating directories, writing files, or network calls. Wrap it in a
lazy initialiser that runs on first use.

Assert it, don't assume it:

```bash
rm -rf data && npm run build && ls data   # must NOT exist afterwards
```

If `data/` reappears during a build, something is touching SQLite at import
time and the deploy will fail.

### Then check runtime separately

The build passing does not mean the server runs. Production mode differs from
dev — check both:

```bash
PORT=3100 npm start
curl -s -X POST localhost:3100/api/login -H 'Content-Type: application/json' -d '{"pwd":"<pwd>"}'
```

## Environment

- **Node 22 is required.** `better-sqlite3` segfaults (exit 139) on Node
  v20.20.2 on this machine — the prebuilt binary *and* a from-source build both
  crash on `dlopen`, so nothing that imports `db.js` will start. Run
  `nvm use 22` first.
- **Port 3000 is usually taken** by another local project. Run this app on
  another port (`PORT=3100`). But the Google OAuth redirect URI is registered as
  `http://localhost:3000/oauth2callback`, so port 3000 *must* be free when
  running `scripts/get-google-refresh-token.js`.

## Deployment (Render, free plan)

- `data/app.db` is **wiped on every redeploy** — there is no persistent disk.
  Nothing durable may live in SQLite. Google Drive is the source of truth for
  shared files; `AUTH_SECRET` and `INITIAL_PASSWORD` come from the environment
  so sessions and the password survive a wipe.
- All env vars live in the Render dashboard. Never in `render.yaml` — it is
  committed to git.

## Secrets

- `.env` and `source/` are gitignored. `source/` holds the setup runbook, which
  contains live Google credentials.
- Never commit credentials, and never use GitHub's "unblock-secret" URLs to push
  past secret scanning — that publishes the secret permanently.
