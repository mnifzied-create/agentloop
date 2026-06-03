import type { Metadata } from "next";
import "./globals.css";

const DESC =
  "The Claude agent starter you can actually read — streaming + tool use in one readable loop. Clone, add a key, deploy. Free + MIT.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "AgentLoop — the readable Claude agent starter",
  description: DESC,
  openGraph: {
    title: "AgentLoop — the readable Claude agent starter",
    description: DESC,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentLoop — the readable Claude agent starter",
    description: DESC,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
