import { ImageResponse } from "next/og";
import { SITE_CONFIG } from "@/lib/constants";

export function GET(request: Request) {
  const url = new URL(request.url);
  const titleParam = url.searchParams.get("title")?.trim();
  const title = titleParam || SITE_CONFIG.title;
  const subtitle =
    url.searchParams.get("subtitle")?.trim() || "Hum to Song";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px 80px",
          backgroundColor: "#F5F1EB",
          color: "#1A1A1A",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <p
            style={{
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {title}
          </p>
          <p
            style={{
              fontSize: 32,
              lineHeight: 1.4,
              opacity: 0.75,
              maxWidth: 900,
              margin: 0,
            }}
          >
            {subtitle}
          </p>
        </div>
        <div
          style={{
            position: "absolute",
            right: 80,
            bottom: 48,
            fontSize: 20,
            opacity: 0.4,
            letterSpacing: "0.1em",
          }}
        >
          MURMUR
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
