// Syncs (and classifies) the "guaranteed apps" list — see
// lib/guaranteedApps.ts for what these are and why. Run manually whenever
// that list changes:
//
//   npx tsx scripts/seed-guaranteed.ts
//
// For each app: resolves metadata + reviews live from Apple (same
// reviewsSavedOk-gated logic as every other write site — see
// lib/reviews.ts's ALV-85 doc comment), then upserts into `apps`.
// Classification: an app already source='seed_carousel' keeps that
// classification (the carousel is its own, even more visible guarantee —
// same "don't downgrade" priority rule scripts/seed-initial.ts uses for
// carousel-vs-category); anything else gets source='seed_guaranteed'.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { GUARANTEED_APPS } from "../lib/guaranteedApps";
import { lookupApps } from "../lib/appLookup";
// Type-only — erased at compile time, so importing it statically never
// triggers lib/reviews.ts's module body (which imports lib/supabase.ts,
// see below) to run.
import type { Review } from "../lib/reviews";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = resolve(__dirname, "../.env.local");
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY — check .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseSecretKey);

const DEFAULT_COUNTRY = "cl";
const REQUEST_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  // Dynamic import, deliberately deferred until after loadEnvLocal() has
  // already populated process.env: lib/reviews.ts imports lib/supabase.ts
  // at module scope, which reads process.env.SUPABASE_URL/SECRET_KEY the
  // instant the module loads. A static top-of-file import gets hoisted
  // and evaluated before this script's own env-loading code ever runs
  // (confirmed the hard way — "supabaseUrl is required" on the first
  // run), so this must stay a runtime import, not a static one.
  const { fetchReviewsLive, toReviewInsertRows } = await import("../lib/reviews");

  console.log(`=== seed-guaranteed: syncing ${GUARANTEED_APPS.length} apps ===`);

  const trackIds = GUARANTEED_APPS.map((a) => a.trackId);
  const { data: existingRows } = await supabase
    .from("apps")
    .select("track_id, source")
    .in("track_id", trackIds);
  const existingSource = new Map<number, string>(
    (existingRows ?? []).map((r) => [r.track_id as number, r.source as string])
  );

  const metadataMap = await lookupApps(trackIds, DEFAULT_COUNTRY);
  console.log(`Metadata resolved for ${metadataMap.size}/${trackIds.length} apps`);

  for (const app of GUARANTEED_APPS) {
    const info = metadataMap.get(app.trackId);
    if (!info) {
      console.log(`  ${app.trackId} "${app.name}": SKIPPED (not found in iTunes Lookup)`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // Carousel classification always wins — it's already a stronger
    // guarantee (also drives the visible UI carousel) than
    // seed_guaranteed, same priority rule as the initial seed script.
    const source = existingSource.get(app.trackId) === "seed_carousel" ? "seed_carousel" : "seed_guaranteed";

    let reviews: Review[] = [];
    let reviewsFetchOk = true;
    try {
      const result = await fetchReviewsLive(String(app.trackId), DEFAULT_COUNTRY, 1);
      reviews = result.reviews;
    } catch (err) {
      reviewsFetchOk = false;
      console.log(`  ${app.trackId} "${info.trackName}": reviews FAILED (${errorMessage(err)})`);
    }

    // Same ALV-85-safe ordering as every other write site: save reviews
    // (if any) before writing last_synced_at/reviews_confirmed_empty, and
    // only mark either when the whole fetch+save round trip succeeded.
    let reviewsSavedOk = reviewsFetchOk;
    if (reviewsFetchOk && reviews.length > 0) {
      const { error: reviewsError } = await supabase
        .from("reviews")
        .upsert(toReviewInsertRows(app.trackId, DEFAULT_COUNTRY, reviews), { onConflict: "id" });
      if (reviewsError) {
        reviewsSavedOk = false;
        console.log(`  ${app.trackId} "${info.trackName}": reviews upsert FAILED (${reviewsError.message})`);
      }
    }

    const { error: appError } = await supabase.from("apps").upsert(
      {
        track_id: app.trackId,
        track_name: info.trackName,
        artist_name: info.artistName ?? null,
        artwork_url_100: info.artworkUrl100 ?? null,
        primary_genre_name: info.primaryGenreName ?? null,
        average_user_rating: info.averageUserRating ?? null,
        user_rating_count: info.userRatingCount ?? null,
        country: DEFAULT_COUNTRY,
        source,
        last_synced_at: reviewsSavedOk ? new Date().toISOString() : null,
        reviews_confirmed_empty: reviewsSavedOk && reviews.length === 0,
      },
      { onConflict: "track_id" }
    );

    if (appError) {
      console.log(`  ${app.trackId} "${info.trackName}": apps upsert FAILED (${appError.message})`);
    } else {
      console.log(`  ${app.trackId} "${info.trackName}" (${source}): OK, ${reviews.length} reviews`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("=== seed-guaranteed: done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
