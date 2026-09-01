import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · Share Chat',
  description: 'How Share Chat handles your data and your Google account.',
};

const UPDATED = '1 September 2026';
const CONTACT = 'sagar.vavadiya.ws@gmail.com';

export default function PrivacyPage() {
  return (
    <div className="doc">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {UPDATED}</p>

      <p>
        Share Chat is a small, private, password-protected chat and file-sharing
        tool run by an individual for personal use. This policy explains what it
        stores and what it does with your Google account.
      </p>

      <h2>Who runs this app</h2>
      <p>
        Share Chat is operated by an individual, reachable at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. It is not a company and has
        no employees.
      </p>

      <h2>What the app stores</h2>
      <ul>
        <li>
          <strong>Chat messages</strong> are relayed between connected browsers
          in real time and are never written to a database. They exist only in
          the memory of the browsers taking part, and disappear on reload.
        </li>
        <li>
          <strong>The display name</strong> you type when joining is shown to
          other people in the chat for the duration of your session. It is not
          stored on the server.
        </li>
        <li>
          <strong>Files you upload</strong> on the File Share page are stored in
          the operator&rsquo;s own Google Drive. The app&rsquo;s own database
          keeps only the file name, size, type, the display name of whoever
          uploaded it, a timestamp, and the Google Drive file id.
        </li>
        <li>
          <strong>A shared access password</strong> is stored so the app can
          check sign-ins. Sessions are short-lived signed tokens held in your
          browser&rsquo;s local storage.
        </li>
      </ul>

      <h2>How the app uses your Google account</h2>
      <p>
        Share Chat connects to <strong>one</strong> Google account — the
        operator&rsquo;s — to store shared files. Other people using the app do
        not connect their own Google accounts and are never asked to.
      </p>
      <p>
        The connection uses the <code>drive.file</code> scope. This is the
        narrowest Drive permission Google offers: the app can only see and
        manage files it created itself. It <strong>cannot</strong> read, list,
        modify, or delete anything else in that Drive account.
      </p>
      <p>
        The access credential is held on the server only. It is never sent to a
        browser and never shared with anyone.
      </p>

      <h2>Limited Use disclosure</h2>
      <p>
        Share Chat&rsquo;s use and transfer of information received from Google
        APIs to any other app adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>What the app does not do</h2>
      <ul>
        <li>No advertising, and no data is sold or rented.</li>
        <li>No analytics, tracking pixels, or third-party trackers.</li>
        <li>No sharing of your data with third parties.</li>
        <li>No use of your data to train machine-learning models.</li>
      </ul>

      <h2>How long data is kept</h2>
      <p>
        Uploaded files are kept until someone deletes them. Any signed-in user
        can delete any file from the File Share page; deleting removes it from
        Google Drive as well as from the app&rsquo;s list. Chat messages are
        never stored, so there is nothing to delete.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Delete any uploaded file from the File Share page at any time.</li>
        <li>
          Ask for removal of anything else by emailing{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </li>
        <li>
          If you are the operator, you can revoke the app&rsquo;s access to your
          Google account at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Access requires a shared password, and every request that reads or
        changes data is checked against a signed session token on the server.
        That said, this is a small personal project, not audited infrastructure
        — please do not upload anything genuinely sensitive.
      </p>

      <h2>Children</h2>
      <p>Share Chat is not intended for use by children under 13.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the date at the top of this page will change
        with it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>

      <p className="doc-nav">
        <Link href="/">← Back to Share Chat</Link> · <Link href="/terms">Terms of Service</Link>
      </p>
    </div>
  );
}
