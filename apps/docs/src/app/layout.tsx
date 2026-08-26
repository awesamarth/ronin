import type { Metadata } from "next";
import "./globals.css";
import "fumadocs-ui/css/style.css";
import { RootProvider } from "fumadocs-ui/provider/next";

export const metadata: Metadata = {
  title: "Ronin Docs",
  description: "Generated DevRel knowledge for protocol and SDK teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
