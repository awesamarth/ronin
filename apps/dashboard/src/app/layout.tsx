import type { Metadata } from "next";
import { Geist, Geist_Mono, UnifrakturMaguntia } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const roninDisplay = UnifrakturMaguntia({
  variable: "--font-ronin-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Ronin",
  description: "Agentic solutions engineering for protocol teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${roninDisplay.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-ronin-background text-ronin-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
