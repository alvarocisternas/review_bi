import { ImageResponse } from "next/og";
import { BrandBars } from "@/lib/brandIcon";

// ALV-84: generated favicon (rel="icon") — complements the existing static
// app/favicon.ico (older browsers/crawlers) with a next/og-generated PNG
// that modern browsers prefer. See lib/brandIcon.tsx for why this draws
// bars instead of using an emoji character.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandBars boxSize={size.width} />, { ...size });
}
