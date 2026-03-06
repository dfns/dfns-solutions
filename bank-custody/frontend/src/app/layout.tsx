/**
 * Root layout — wraps every page in the app.
 *
 * Sets global metadata (title, description) and base styles.
 * No providers or context needed — auth is handled via cookies and the useApi hook.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SecureBank — Your accounts",
  description: "Banking platform with integrated crypto custody",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", background: "#f5f7fa", color: "#1a1a2e" }}>
        {children}
      </body>
    </html>
  );
}
