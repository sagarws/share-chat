import { NextResponse } from 'next/server';
import { verifyToken, listFolders, getSelectedFolder } from '../../../../db';
import { isConfigured, buildFolderTree } from '../../../../drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readToken = (req) => {
  const header = req.headers.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : '';
};

// Walking the tree costs one Drive call per folder, and the sidebar asks for it
// on every page load. A short cache keeps that from becoming N calls per
// navigation while still picking up a new subfolder almost immediately.
let cache = { key: '', at: 0, tree: null };
const TTL_MS = 20_000;

export async function GET(req) {
  if (!verifyToken(readToken(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const roots = listFolders();
  const selected = getSelectedFolder();

  if (!isConfigured() || roots.length === 0) {
    return NextResponse.json({ ok: true, tree: [], selected });
  }

  const key = roots.map((r) => `${r.id}:${r.name}`).join(',');
  const fresh = new URL(req.url).searchParams.has('refresh');

  if (!fresh && cache.tree && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, tree: cache.tree, selected, cached: true });
  }

  try {
    const tree = await buildFolderTree(roots);
    cache = { key, at: Date.now(), tree };
    return NextResponse.json({ ok: true, tree, selected });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not read the folder tree.' },
      { status: 502 }
    );
  }
}
