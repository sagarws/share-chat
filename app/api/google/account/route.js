import { NextResponse } from 'next/server';
import { removeAccount } from '../../../../db';
import { isConfigured, isOAuthConfigured, revokeToken } from '../../../../drive';
import { resolveDrive } from '../../../serverDrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Which Drive this browser is using. Backs the /drive page.
export async function GET(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;

  const a = ctx.account;
  return NextResponse.json({
    ok: true,
    canConnect: isOAuthConfigured(),
    sharedConfigured: isConfigured(),
    account: a
      ? {
          email: a.email,
          name: a.name,
          picture: a.picture,
          folderId: a.rootFolderId,
          connectedAt: a.createdAt,
        }
      : null,
  });
}

// Disconnect: revoke the app's access at Google and forget the account. Files
// already uploaded stay in the user's Drive.
export async function DELETE(req) {
  const ctx = resolveDrive(req);
  if (ctx.error) return ctx.error;
  if (!ctx.account) {
    return NextResponse.json({ ok: false, error: 'No Google Drive is connected.' }, { status: 400 });
  }
  await revokeToken(ctx.account.refreshToken);
  removeAccount(ctx.account.id);
  return NextResponse.json({ ok: true });
}
