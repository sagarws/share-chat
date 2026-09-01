# Google Drive File Sharing Integration — Development Prompt

You are working on my **existing web application**. Your task is to add a complete **Google Drive integration and file-sharing functionality** without breaking, removing, or changing any existing functionality or user workflows.

## 1. Main Requirement

Add a new feature that allows users to:

1. Connect their Google Drive from inside the web application.
2. Upload files using drag-and-drop or file selection.
3. Store uploaded files in the user's Google Drive.
4. Generate a unique shareable link for every uploaded file.
5. Allow anyone with the generated link to view/download the shared file through my application.
6. Allow users to manage their uploaded/shared files.
7. Allow users to disconnect their Google Drive.
8. Never require the user to manually create Google Cloud credentials, copy tokens, or enter Google API credentials.

The user experience should be:

```text
My Web App
    ↓
Connect Google Drive
    ↓
Google Login / Permission
    ↓
Google Drive Connected
    ↓
Drag & Drop File
    ↓
Upload to User's Google Drive
    ↓
Generate Share Link
    ↓
Copy Link
```

---

# 2. Important OAuth Requirement

Implement Google OAuth correctly.

### Admin/developer setup

The application owner will configure:

* Google Cloud Project
* Google Drive API
* OAuth Consent Screen
* OAuth Web Client
* Client ID
* Client Secret
* Authorized redirect URI

These credentials must be stored ONLY on the backend/server environment.

Example:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

NEVER expose `GOOGLE_CLIENT_SECRET` to the frontend.

### User experience

Users should NOT need to:

* Create a Google Cloud project
* Open Google Cloud Console
* Create OAuth credentials
* Copy/paste access tokens
* Copy/paste refresh tokens
* Configure Google APIs manually

They should simply click:

```text
Connect Google Drive
```

and complete Google's OAuth authorization flow.

---

# 3. OAuth Scope

Use the minimum required Google Drive scope.

Prefer:

```text
https://www.googleapis.com/auth/drive.file
```

Do NOT request full Drive access unless there is a specific technical requirement.

Follow Google's current OAuth requirements and security recommendations.

---

# 4. Google Drive Connection

Create a settings/integration section:

```text
Settings
   ↓
Integrations
   ↓
Google Drive
```

When disconnected:

```text
Google Drive

Store your uploaded files directly in your Google Drive.

[ Connect Google Drive ]
```

When connected:

```text
Google Drive

✓ Connected

Google Account:
user@gmail.com

Storage:
Connected

[ Manage Files ] [ Disconnect ]
```

Do not display sensitive OAuth tokens anywhere in the UI.

---

# 5. Token Storage

After OAuth callback:

* Exchange authorization code for tokens on the backend.
* Store the refresh token securely.
* Encrypt sensitive credentials/tokens at rest if the current architecture supports encryption.
* Never store tokens in localStorage.
* Never send refresh tokens to the frontend.
* Never expose client secrets or refresh tokens through API responses.
* Implement automatic access-token refresh when required.

Use the existing authentication/user system in the application.

A Google Drive connection must belong to the authenticated application user.

---

# 6. Database Design

Inspect the existing database architecture before making changes.

Do NOT create duplicate user/authentication systems.

Add a Google Drive connection model/table appropriate for the existing database.

Example:

```text
GoogleDriveConnection

id
userId
googleAccountEmail
googleAccountId
refreshTokenEncrypted
accessTokenEncrypted (only if needed)
tokenExpiry
createdAt
updatedAt
```

Create a file/share model appropriate for the existing architecture:

```text
SharedFile

id
userId
googleDriveFileId
fileName
mimeType
fileSize
shareToken
expiresAt
downloadCount
status
createdAt
updatedAt
```

Use the project's existing naming conventions and ORM/database patterns.

Add appropriate indexes, especially for:

```text
userId
shareToken
googleDriveFileId
```

`shareToken` must be unique.

---

# 7. File Upload

Create a file-sharing page.

Example UI:

```text
Share Files

┌───────────────────────────────────────┐
│                                       │
│       Drag & Drop files here          │
│                                       │
│             or                        │
│                                       │
│         [ Select Files ]              │
│                                       │
└───────────────────────────────────────┘
```

Support:

* Drag & drop
* File picker
* Multiple files if the existing architecture allows it
* Upload progress
* Upload cancellation if practical
* Upload error handling
* Retry failed uploads

Do not load the entire file into memory unnecessarily.

Use streaming/resumable uploads where appropriate, especially for large files.

---

# 8. Google Drive Folder

Create a dedicated application folder inside the user's Google Drive.

Example:

```text
My Drive
   └── MyApp File Sharing
          ├── file1.pdf
          ├── image.jpg
          └── video.mp4
```

Do not create duplicate folders every time the user logs in.

Find the existing application folder first and reuse it.

Store the Google Drive folder ID in the database if appropriate.

---

# 9. Share Link

After successful upload:

```text
Upload completed!

File:
project-report.pdf

Share link:

https://yourdomain.com/s/AbC123xYz

[ Copy Link ]
```

Generate a cryptographically secure random token.

Do NOT use:

```text
incremental IDs
user IDs
file IDs
email addresses
timestamps
```

as the public share token.

The URL should look like:

```text
https://yourdomain.com/s/{secure-token}
```

---

# 10. Public Download Page

When someone opens:

```text
https://yourdomain.com/s/AbC123xYz
```

show:

```text
┌─────────────────────────────────┐
│                                 │
│          📄 File Name           │
│                                 │
│          25.4 MB                │
│          PDF                    │
│                                 │
│       [ Download File ]         │
│                                 │
└─────────────────────────────────┘
```

The recipient should NOT need to log into my application for a normal public share link.

Do not expose:

* Google Drive file IDs unnecessarily
* OAuth tokens
* User information
* Google account information

---

# 11. Download Architecture

Prefer:

```text
Recipient
   ↓
GET /s/:shareToken
   ↓
Backend
   ↓
Validate token
   ↓
Check expiration/status
   ↓
Find Google Drive file
   ↓
Google Drive API
   ↓
Stream file
   ↓
Recipient
```

Do not expose private OAuth credentials to the client.

Do not rely solely on a publicly exposed Google Drive URL if that would bypass the application's sharing controls.

---

# 12. Link Expiration

Support optional expiration.

Example:

```text
Link expiration

○ Never
○ 1 day
○ 7 days
○ 30 days
○ Custom
```

When expired:

```text
This sharing link has expired.
```

The file should remain in Google Drive unless the user explicitly chooses to delete it.

---

# 13. File Management

Create:

```text
My Files
```

Example:

```text
--------------------------------------------------
File             Size       Shared       Actions
--------------------------------------------------
report.pdf       25 MB      Yes          Copy
image.jpg        4 MB       Yes          Copy
invoice.pdf      2 MB       No           Share
--------------------------------------------------
```

Actions:

* Copy share link
* Create/share link
* Disable link
* Delete file
* View details

If a share link is disabled, the Google Drive file should NOT automatically be deleted.

---

# 14. Delete Behaviour

When deleting a file from the application:

Ask:

```text
Delete file?

○ Remove sharing link only
○ Delete file from Google Drive

[ Cancel ] [ Confirm ]
```

Be careful not to permanently delete the user's Google Drive file without explicit confirmation.

---

# 15. API Design

Follow the existing backend architecture.

Potential endpoints:

```text
GET    /api/integrations/google-drive/connect
GET    /api/integrations/google-drive/callback
GET    /api/integrations/google-drive/status
POST   /api/integrations/google-drive/disconnect

POST   /api/files/upload
GET    /api/files
GET    /api/files/:id
DELETE /api/files/:id

POST   /api/files/:id/share
DELETE /api/files/:id/share

GET    /api/share/:token
GET    /api/share/:token/download
```

Do NOT blindly implement these exact paths if the existing application follows a different API convention. Adapt them to the current project architecture.

---

# 16. Security Requirements

Follow secure coding practices.

### Authentication

All private file-management APIs must require the existing application authentication.

### Authorization

A user must only be able to manage their own Google Drive connection and files.

### OAuth

* Validate OAuth state.
* Prevent CSRF.
* Validate redirect URI.
* Keep client secret server-side.
* Encrypt stored refresh tokens where practical.
* Never log OAuth tokens.

### Share Tokens

Use cryptographically secure random tokens.

Example concept:

```text
crypto.randomBytes(...)
```

Do not use predictable IDs.

### Upload Validation

Validate:

* File size
* MIME type where appropriate
* Filename
* Request authentication
* Upload errors

Do not trust the MIME type supplied by the browser.

### Rate Limiting

Add reasonable rate limiting to:

```text
Upload endpoints
Share endpoints
Public download endpoints
OAuth endpoints
```

if the existing backend supports rate limiting.

---

# 17. Google API Error Handling

Handle common cases gracefully:

```text
Google Drive disconnected
Google token expired
Refresh token revoked
Google API quota exceeded
Storage quota exceeded
Upload failed
Network failure
File deleted from Google Drive
Permission denied
Invalid share token
Expired share token
```

Example:

```text
Your Google Drive connection has expired.

[ Reconnect Google Drive ]
```

Do not expose raw Google API errors to end users.

Log useful technical details on the backend without logging sensitive tokens.

---

# 18. UI/UX Requirements

Use the application's existing UI system.

If the project already uses:

* Tailwind
* shadcn/ui
* existing components
* existing buttons
* existing modals
* existing toast notifications

reuse them.

Do NOT introduce another UI library.

The new functionality must visually match the existing application.

Make the upload interface:

* Responsive
* Desktop friendly
* Mobile friendly
* Accessible
* Clear during upload
* Clear when upload fails
* Clear when Google Drive is disconnected

---

# 19. Do NOT Break Existing Application

Before changing code:

1. Inspect the existing project.
2. Understand authentication.
3. Understand database schema.
4. Understand API structure.
5. Understand frontend routing.
6. Understand existing storage/file functionality.
7. Identify reusable components.

Do NOT:

* Replace existing authentication
* Replace the database
* Replace existing storage
* Upgrade major dependencies unnecessarily
* Change unrelated UI
* Rewrite unrelated modules
* Remove existing functionality
* Change existing user workflows

Make the smallest clean changes required.

---

# 20. Environment Configuration

Add only required environment variables.

Example:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_DRIVE_FOLDER_NAME=MyApp File Sharing
```

Never commit `.env` values.

Update:

```text
.env.example
```

with empty placeholders.

---

# 21. Documentation

Create/update a documentation file:

```text
docs/google-drive-integration.md
```

Document:

1. Creating Google Cloud project
2. Enabling Google Drive API
3. OAuth consent screen
4. Creating OAuth credentials
5. Configuring redirect URLs
6. Required OAuth scopes
7. Environment variables
8. Local development setup
9. Production setup
10. Google OAuth verification requirements
11. Token/security considerations
12. Troubleshooting

The documentation should explain exactly what the developer needs to configure.

---

# 22. Development Process

Before implementation:

```text
1. Inspect project
2. Identify architecture
3. Identify auth system
4. Identify database/ORM
5. Identify existing file/storage system
6. Identify frontend routing
7. Propose implementation
8. Implement
9. Run lint
10. Run type checking
11. Run tests
12. Fix errors
13. Test OAuth flow
14. Test upload
15. Test public share link
16. Test expiration
17. Test disconnect/reconnect
```

Do not assume the project uses a particular framework or ORM. Inspect the existing code first.

---

# 23. Acceptance Criteria

The feature is complete only when all of the following work:

### Google Drive

* [ ] User can connect Google Drive from the application.
* [ ] User is redirected to Google OAuth.
* [ ] User grants permission.
* [ ] User returns to the application successfully.
* [ ] Connection status is displayed.
* [ ] User can disconnect.
* [ ] User can reconnect.

### Upload

* [ ] User can drag and drop a file.
* [ ] User can select a file.
* [ ] File uploads to Google Drive.
* [ ] Upload progress is displayed.
* [ ] Upload failures are handled.
* [ ] Large files are handled appropriately.

### Sharing

* [ ] Application generates a secure share token.
* [ ] Share URL is generated.
* [ ] User can copy the URL.
* [ ] Public user can open the URL.
* [ ] Public user can download the file.
* [ ] Public user does not need an application account.
* [ ] Google OAuth tokens are never exposed.

### Security

* [ ] Private APIs require authentication.
* [ ] Users cannot access other users' files.
* [ ] Share tokens are unpredictable.
* [ ] OAuth state protection is implemented.
* [ ] Refresh tokens are securely stored.
* [ ] Secrets are server-side only.
* [ ] Sensitive credentials are never logged.

### Existing Application

* [ ] Existing features continue working.
* [ ] Existing authentication continues working.
* [ ] Existing UI is not broken.
* [ ] Existing APIs are not unnecessarily changed.
* [ ] No unnecessary dependency upgrades are introduced.

---

## Final instruction

First inspect the existing application and explain briefly:

1. Current architecture
2. Where Google OAuth should be implemented
3. Where Google Drive upload should be implemented
4. What database changes are required
5. What frontend pages/components are required

Then implement the feature following the existing project's architecture and coding conventions.

**Do not make unrelated changes. Do not replace existing technologies. Do not expose Google credentials or tokens.**
