import { ImageResponse } from "next/og";
import { BrandBars } from "@/lib/brandIcon";

// ALV-84: iOS home-screen icon (rel="apple-touch-icon"). 180x180 is Apple's
// recommended base size for a non-scaled touch icon.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandBars boxSize={size.width} />, { ...size });
}
