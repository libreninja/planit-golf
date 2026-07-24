import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell/app-shell";
import { getAppShellUser } from "@/lib/app-shell/user";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "planit.golf",
  description: "planit.golf member access.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the current viewer once in the root layout so the shell (rail,
  // top bar, account menu) renders on every authenticated route. This makes
  // the whole app dynamic, which is the intended trade for a member app that
  // is never statically served to anonymous traffic.
  const user = await getAppShellUser();
  return (
    <html lang="en">
      <body className={`${inter.variable} ${fraunces.variable}`}>
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
