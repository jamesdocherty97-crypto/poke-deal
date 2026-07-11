import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://poke-deal.vercel.app"),
  applicationName: "Poke Deal",
  title: "Poke Deal",
  description: "Value, stock, price, list, sell.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Poke Deal",
    startupImage: [{ url: "/splash.svg" }],
  },
  icons: {
    icon: [
      { url: "/brand/v2/favicon-v1.ico", sizes: "any" },
      { url: "/brand/v2/favicon-32-v1.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: [{ url: "/brand/v2/favicon-v1.ico" }],
    apple: [{ url: "/brand/v2/apple-touch-icon-180-v1.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    title: "Poke Deal",
    description: "Value, buy, stock, list, sell, and trust every comp.",
    images: [
      {
        url: "/brand/v2/og-share-1200x630-v1.jpg",
        width: 1200,
        height: 630,
        alt: "Poke Deal — Pokémon card dealer operating system",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Poke Deal",
    description: "Value, buy, stock, list, sell, and trust every comp.",
    images: ["/brand/v2/og-share-1200x630-v1.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080b13",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href="/visual/empty/stock.webp" type="image/webp" fetchPriority="high" />
        <link rel="preload" as="image" href="/visual/celebration/pikachu.webp" type="image/webp" fetchPriority="high" />
        <link rel="preload" as="image" href="/visual/empty/session.webp" type="image/webp" fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
