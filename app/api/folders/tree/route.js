import { NextResponse } from 'next/server';
import { listFolders, getSelectedFolder } from '../../../../db';
import { resolveDrive, driveError } from '../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Walking the tree costs one Drive call per folder, and the sidebar asks for it
// on every page load. A short cache keeps that from becoming N calls per
// navigation while still picking up a new subfolder almost immediately.
// One entry per Drive: '' for the shared one, else the connected account id.
const caches = new Map();
const TTL_MS = 20_000;

export async function GET(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;

  const roots = listFolders(ctx.accountId);
  const selected = getSelectedFolder(ctx.accountId);

  if (!ctx.configured || roots.length === 0) {
    return NextResponse.json({ ok: true, tree: [], selected });
  }

  const key = roots.map((r) => `${r.id}:${r.name}`).join(',');
  const fresh = new URL(req.url).searchParams.has('refresh');

  const cache = caches.get(ctx.accountId);
  if (!fresh && cache?.tree && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, tree: cache.tree, selected, cached: true });
  }

  try {
    const tree = await ctx.drive.buildFolderTree(roots);
    caches.set(ctx.accountId, { key, at: Date.now(), tree });
    return NextResponse.json({ ok: true, tree, selected });
  } catch (err) {
    return driveError(err, 'Could not read the folder tree.');
  }
}
