import { NextResponse } from 'next/server';
import { verifyToken, getSelectedFolder, getFolder } from '../../../db';
import { isConfigured, uploadFile, listDriveFiles } from '../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 100 * 1024 * 1024;

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Google Drive is the single source of truth for the listing. Nothing about a
// shared file lives in the local database, so a wiped disk (Render's free plan
// clears it on every redeploy) costs nothing — the list rebuilds itself from
// Drive on the next request.
export async function GET(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!isConfigured()) {
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
    const folderId = asked || getSelectedFolder();

    return NextResponse.json({
      ok: true,
      configured: true,
      maxBytes: MAX_UPLOAD_BYTES,
      folderId,
      files: folderId ? await listDriveFiles(folderId) : [],
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not read files.' },
      { status: 502 }
    );
  }
}

// Upload. The file arrives as the raw request body (no multipart) with its
// metadata in headers, so the bytes stream straight through to Drive instead
// of being buffered in memory.
export async function POST(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  if (!isConfigured()) {
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

  // Upload into the folder the client has selected, falling back to the
  // remembered default. Only registered folders are accepted.
  const asked = decode(req.headers.get('x-folder')).trim();
  const folderId = asked && getFolder(asked) ? asked : getSelectedFolder();
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
  if (size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File is too large (max ${formatSize(MAX_UPLOAD_BYTES)}).` },
      { status: 413 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ ok: false, error: 'No file body.' }, { status: 400 });
  }

  try {
    const driveId = await uploadFile({ name, mime, size, uploader, folderId, body: req.body });
    return NextResponse.json({
      ok: true,
      file: { id: driveId, name, mime, size, uploader, createdAt: Date.now() },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Upload failed.' },
      { status: 502 }
    );
  }
}
