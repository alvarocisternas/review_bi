"use client";

import { useEffect, useState } from "react";
import { GENRE_IDS } from "@/lib/genreIds";

interface CarouselApp {
  trackId: number;
  artworkUrl100: string;
}

interface TopAppsResult {
  results?: { trackId?: number; artworkUrl100?: string }[];
}

// How many random categories to sample per page load — kept small (5-6) so
// a refresh doesn't hammer /api/top-apps; the shuffle below already gives
// plenty of variety without needing a bigger sample.
const CATEGORIES_TO_SAMPLE = 6;
// How many logos to keep from the pooled results, spread across the rows.
const POOL_TARGET_SIZE = 21;
const ROW_COUNT = 3;
// One duration per row (seconds omitted, added via inline style) — slightly
// different per row so three rows of the same content don't scroll in
// perfect lockstep; all comfortably inside the "one loop every 20-40s" ask.
const ROW_DURATIONS = ["28s", "34s", "40s"];

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function AppCarousel() {
  const [rows, setRows] = useState<CarouselApp[][] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPool() {
      const allCategories = Object.keys(GENRE_IDS);
      const chosenCategories = shuffle(allCategories).slice(
        0,
        CATEGORIES_TO_SAMPLE
      );

      const settled = await Promise.allSettled(
        chosenCategories.map(async (category) => {
          const response = await fetch(
            `/api/top-apps?genre=${encodeURIComponent(category)}`
          );
          if (!response.ok) {
            throw new Error(`top-apps failed for ${category}`);
          }
          return (await response.json()) as TopAppsResult;
        })
      );

      if (cancelled) return;

      // Degrade gracefully: a failed category is just omitted from the
      // pool, never surfaced as an error — this carousel is decorative.
      const pool: CarouselApp[] = [];
      for (const outcome of settled) {
        if (outcome.status !== "fulfilled") continue;
        for (const app of outcome.value.results ?? []) {
          if (app.trackId != null && app.artworkUrl100) {
            pool.push({ trackId: app.trackId, artworkUrl100: app.artworkUrl100 });
          }
        }
      }

      if (pool.length === 0) {
        setRows(null);
        return;
      }

      const selected = shuffle(pool).slice(0, POOL_TARGET_SIZE);

      const nextRows: CarouselApp[][] = Array.from(
        { length: ROW_COUNT },
        () => []
      );
      selected.forEach((app, index) => {
        nextRows[index % ROW_COUNT].push(app);
      });

      // A row needs at least a couple of logos to loop convincingly —
      // drop any that ended up with too little instead of showing a
      // near-empty, jerky strip.
      setRows(nextRows.filter((row) => row.length >= 2));
    }

    loadPool();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows || rows.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden bg-zinc-900 py-3 dark:bg-zinc-100">
      <div className="flex flex-col gap-3">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={rowIndex === 0 ? "flex" : "hidden md:flex"}
          >
            <div
              className="animate-marquee flex shrink-0 items-center gap-3 pr-3"
              style={{ animationDuration: ROW_DURATIONS[rowIndex] }}
            >
              {[...row, ...row].map((app, index) => (
                // Decorative only — empty alt so screen readers skip these.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${app.trackId}-${index}`}
                  src={app.artworkUrl100}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-xl"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
