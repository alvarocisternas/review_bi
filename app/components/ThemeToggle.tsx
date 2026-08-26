"use client";

import { useState } from "react";

/**
 * Button that toggles the "dark" class on <html>. Rendered in the normal
 * document flow (centered by its parent in page.tsx, below the logo
 * carousel and above the title) — no fixed/absolute positioning here.
 *
 * No localStorage/sessionStorage — theme lives purely in this component's
 * React state, per the MVP requirement. The initial value (true) matches
 * the "dark" class layout.tsx renders on <html> server-side, so there's
 * no hydration mismatch and no flash of the wrong theme on first paint;
 * the DOM class is only ever mutated after that, directly in the click
 * handler.
 */
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  function handleToggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-base shadow-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
