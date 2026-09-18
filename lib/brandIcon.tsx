// Shared visual for every generated image (favicon, apple touch icon, OG
// image) — a simple 3-bar "chart" glyph drawn with plain flexbox divs.
//
// Deliberately NOT an actual emoji character (e.g. "📊"): next/og's
// ImageResponse renders emoji by fetching their glyph from a CDN
// (twemoji by default) at render time — see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/image-response.md.
// These icon/OG routes are statically generated at build time, so that
// fetch would need to succeed during `next build` in every environment
// this repo is ever built in (including sandboxed/offline CI). Drawing the
// bars ourselves needs no network at all and still reads as "a simple
// generic icon" per the task.
export const BRAND_BG = "#18181b"; // zinc-900
export const BRAND_BAR = "#fafafa"; // zinc-50

export function BrandBars({ boxSize }: { boxSize: number }) {
  const barWidth = Math.max(2, Math.round(boxSize * 0.14));
  const gap = Math.max(1, Math.round(boxSize * 0.08));
  const heightFractions = [0.4, 0.85, 0.6];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap,
        background: BRAND_BG,
      }}
    >
      {heightFractions.map((fraction, index) => (
        <div
          key={index}
          style={{
            width: barWidth,
            height: Math.round(boxSize * fraction),
            background: BRAND_BAR,
            borderRadius: Math.max(1, Math.round(barWidth * 0.25)),
          }}
        />
      ))}
    </div>
  );
}
