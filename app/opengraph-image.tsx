import { ImageResponse } from "next/og";

export const alt = "AgentLoop — the readable Claude agent starter";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Auto-generated social-share card (1200x630) for X / Reddit / HN previews.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#0b0d12",
          backgroundImage:
            "radial-gradient(900px 500px at 30% -120px, #1b2236 0%, #0b0d12 60%)",
          padding: "90px",
          color: "#e6e9ef",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, color: "#8b93a7", marginBottom: 28 }}>
          AgentLoop
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: "-2px",
          }}
        >
          <span>The Claude agent starter</span>
          <span style={{ color: "#6d8bff" }}>you can actually read.</span>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#8b93a7", marginTop: 36 }}>
          Streaming + tool use in ~150 lines · MIT
        </div>
      </div>
    ),
    { ...size },
  );
}
