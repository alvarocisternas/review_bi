import { ImageResponse } from "next/og";
import { BRAND_BAR, BrandBars } from "@/lib/brandIcon";

// ALV-84: static OG/Twitter card image shown when the link is shared on
// LinkedIn/social — Next.js wires this up automatically as og:image (and
// twitter:image) for every page under app/, no manual metadata needed.
export const alt = "Benchmark Review Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          fontFamily: "sans-serif",
        }}
      >
        {/* satori (next/og's renderer) requires every <div> whose child is
            an element — not plain text — to declare an explicit display,
            even with just one child; see the ALV-84 task report for where
            this was confirmed against satori's actual source. */}
        <div style={{ width: 96, height: 96, display: "flex" }}>
          <BrandBars boxSize={96} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 36,
          }}
        >
          <div style={{ fontSize: 56, fontWeight: 700, color: BRAND_BAR }}>
            Benchmark Review Intelligence
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#09090b",
              background: BRAND_BAR,
              borderRadius: 6,
              padding: "6px 12px",
            }}
          >
            CL
          </div>
        </div>
        <div style={{ fontSize: 28, marginTop: 20, color: "#a1a1aa" }}>
          Analiza y compara reseñas de apps del App Store con IA
        </div>
      </div>
    ),
    { ...size }
  );
}
