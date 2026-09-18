"use client";

import { useState } from "react";

interface AppIconProps {
  src: string | null | undefined;
  name: string;
  className: string;
  /** True for purely decorative uses (the logo carousel) — renders with
   * alt="" / aria-hidden and skips the initials fallback so a broken image
   * there degrades to a blank tile instead of visible "??" letters. */
  decorative?: boolean;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * ALV-84: <img> wrapper for App Store artwork (artworkUrl100) with a
 * graceful fallback. Apple's CDN artwork URLs occasionally 404/expire —
 * without this, a broken one renders the browser's native broken-image
 * icon, which reads as the app being broken rather than one icon. Falls
 * back to a tile with the app's initials (sized via the same `className`
 * as the <img> it replaces, so callers never need conditional layout
 * logic around this).
 */
export default function AppIcon({
  src,
  name,
  className,
  decorative = false,
}: AppIconProps) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div
        className={`flex items-center justify-center bg-zinc-200 font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 ${className}`}
        aria-hidden={decorative || undefined}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
      >
        {decorative ? null : initialsFor(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={decorative ? "" : name}
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
