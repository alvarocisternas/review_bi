"use client";

import { CAROUSEL_APPS } from "@/lib/carouselApps";

// Decorative logo strip above the search UI. Uses a fixed, curated list of
// apps (see lib/carouselApps.ts) in a fixed, pre-shuffled order — no fetch
// calls and no runtime randomness, so the order is identical on every page
// load and every reload. Single row, shown the same way on all breakpoints.
//
// The old version sampled random categories from /api/top-apps on every
// mount (3 rows, re-shuffled per load). That logic is kept below, commented
// out, in case we want to revert:
//
// import { useEffect, useState } from "react";
// import { GENRE_IDS } from "@/lib/genreIds";
//
// interface CarouselApp {
//   trackId: number;
//   artworkUrl100: string;
// }
//
// interface TopAppsResult {
//   results?: { trackId?: number; artworkUrl100?: string }[];
// }
//
// const CATEGORIES_TO_SAMPLE = 6;
// const POOL_TARGET_SIZE = 21;
// const ROW_COUNT = 3;
// const ROW_DURATIONS = ["28s", "34s", "40s"];
//
// function shuffle<T>(array: T[]): T[] {
//   const copy = [...array];
//   for (let i = copy.length - 1; i > 0; i--) {
//     const j = Math.floor(Math.random() * (i + 1));
//     [copy[i], copy[j]] = [copy[j], copy[i]];
//   }
//   return copy;
// }
//
// export default function AppCarousel() {
//   const [rows, setRows] = useState<CarouselApp[][] | null>(null);
//
//   useEffect(() => {
//     let cancelled = false;
//
//     async function loadPool() {
//       const allCategories = Object.keys(GENRE_IDS);
//       const chosenCategories = shuffle(allCategories).slice(
//         0,
//         CATEGORIES_TO_SAMPLE
//       );
//
//       const settled = await Promise.allSettled(
//         chosenCategories.map(async (category) => {
//           const response = await fetch(
//             `/api/top-apps?genre=${encodeURIComponent(category)}`
//           );
//           if (!response.ok) {
//             throw new Error(`top-apps failed for ${category}`);
//           }
//           return (await response.json()) as TopAppsResult;
//         })
//       );
//
//       if (cancelled) return;
//
//       const pool: CarouselApp[] = [];
//       for (const outcome of settled) {
//         if (outcome.status !== "fulfilled") continue;
//         for (const app of outcome.value.results ?? []) {
//           if (app.trackId != null && app.artworkUrl100) {
//             pool.push({ trackId: app.trackId, artworkUrl100: app.artworkUrl100 });
//           }
//         }
//       }
//
//       if (pool.length === 0) {
//         setRows(null);
//         return;
//       }
//
//       const selected = shuffle(pool).slice(0, POOL_TARGET_SIZE);
//
//       const nextRows: CarouselApp[][] = Array.from(
//         { length: ROW_COUNT },
//         () => []
//       );
//       selected.forEach((app, index) => {
//         nextRows[index % ROW_COUNT].push(app);
//       });
//
//       setRows(nextRows.filter((row) => row.length >= 2));
//     }
//
//     loadPool();
//
//     return () => {
//       cancelled = true;
//     };
//   }, []);
//
//   if (!rows || rows.length === 0) {
//     return null;
//   }
//
//   return ( ...3-row JSX... );
// }

export default function AppCarousel() {
  return (
    <div className="w-full overflow-hidden bg-zinc-900 py-3 dark:bg-zinc-100">
      <div
        className="animate-marquee flex w-max shrink-0 items-center gap-3 pr-3"
        style={{ animationDuration: "36s" }}
      >
        {[...CAROUSEL_APPS, ...CAROUSEL_APPS].map((app, index) => (
          // Decorative only — empty alt so screen readers skip these.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${app.trackId}-${index}`}
            src={app.artworkUrl100}
            alt=""
            className="h-12 w-12 flex-shrink-0 rounded-xl md:h-14 md:w-14"
          />
        ))}
      </div>
    </div>
  );
}
