import { NextResponse } from 'next/server';
import { getSelectedFolder } from '../../../db';
import { resolveDrive, driveError } from '../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Uploads are unlimited by default: 0 means "no cap". The body is streamed
// straight into a Drive resumable session, so nothing is buffered here and
// size costs no memory. Set MAX_UPLOAD_BYTES to a byte count to reimpose one.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 0;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

// Google Drive is the single source of truth for the listing. Nothing about a
// shared file lives in the local database, so a wiped disk (Render's free plan
// clears it on every redeploy) costs nothing — the list rebuilds itself from
// Drive on the next request.
export async function GET(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  if (!ctx.configured) {
    return NextResponse.json({
      ok: true,
      configured: false,
      maxBytes: MAX_UPLOAD_BYTES,
      folderId: '',
      files: [],
    });
  }
  try {
    // ?folder=<id> scopes the listing; without it, the remembered default.
    const asked = new URL(req.url).searchParams.get('folder');
    const folderId = asked || getSelectedFolder(ctx.accountId);

    return NextResponse.json({
      ok: true,
      configured: true,
      maxBytes: MAX_UPLOAD_BYTES,
      folderId,
      files: folderId ? await ctx.drive.listDriveFiles(folderId) : [],
    });
  } catch (err) {
    return driveError(err, 'Could not read files.');
  }
}

// Upload. The file arrives as the raw request body (no multipart) with its
// metadata in headers, so the bytes stream straight through to Drive instead
// of being buffered in memory.
export async function POST(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  if (!ctx.configured) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
          'GOOGLE_REFRESH_TOKEN and GOOGLE_DRIVE_FOLDER_ID in the environment.',
      },
      { status: 503 }
    );
  }

  const decode = (v) => {
    try {
      return decodeURIComponent(v || '');
    } catch {
      return '';
    }
  };

  const name = decode(req.headers.get('x-file-name')).trim().slice(0, 200) || 'file';
  const mime =
    (req.headers.get('x-file-type') || '').slice(0, 100) || 'application/octet-stream';
  const uploader = decode(req.headers.get('x-uploader')).trim().slice(0, 30);
  // Written to the Drive file's description, so it is visible in Drive too.
  const description = decode(req.headers.get('x-description')).trim().slice(0, 500);

  // Upload into the folder the client has selected, falling back to the
  // remembered default. Any folder in the tree is valid, including a
  // subfolder; an id Drive cannot reach fails with a clear error below.
  const asked = decode(req.headers.get('x-folder')).trim();
  const folderId = asked || getSelectedFolder(ctx.accountId);
  if (!folderId) {
    return NextResponse.json(
      { ok: false, error: 'No Drive folder configured. Add one first.' },
      { status: 400 }
    );
  }

  // Content-Length is set by the browser and is what Drive must agree with.
  const size = Number(req.headers.get('content-length'));
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: 'File is empty.' }, { status: 400 });
  }
  if (MAX_UPLOAD_BYTES > 0 && size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File is too large (max ${formatSize(MAX_UPLOAD_BYTES)}).` },
      { status: 413 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ ok: false, error: 'No file body.' }, { status: 400 });
  }

  try {
    const driveId = await ctx.drive.uploadFile({
      name,
      mime,
      size,
      uploader,
      description,
      folderId,
      body: req.body,
    });
    return NextResponse.json({
      ok: true,
      file: { id: driveId, name, mime, size, uploader, description, createdAt: Date.now() },
    });
  } catch (err) {
    return driveError(err, 'Upload failed.');
  }
}
