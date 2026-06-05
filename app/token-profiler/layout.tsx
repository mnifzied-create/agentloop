import type { Metadata } from "next";

const DESC =
  "Free, in-browser estimator for what your AI agent loop costs in tokens. See the hidden per-turn cost of system prompts, tool schemas, and tool outputs — and compare model pricing. No key, no upload.";

export const metadata: Metadata = {
  title: "Agent Token Profiler — see what your agent loop costs",
  description: DESC,
  openGraph: {
    title: "Agent Token Profiler — see what your agent loop costs",
    description: DESC,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Token Profiler",
    description: DESC,
  },
};

export default function ProfilerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
