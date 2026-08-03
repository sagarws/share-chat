import './globals.css';

export const metadata = {
  title: 'Chat App',
  description: 'Realtime chat over SSE. Messages kept in local state only.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
