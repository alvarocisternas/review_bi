// One-time initial seed for the `apps`/`reviews` cache tables.
//
// Run manually, ONCE, from a developer machine — not part of the app or
// the cron:
//
//   npx tsx scripts/seed-initial.ts
//
// It populates:
//   - The 21 carousel apps (lib/carouselApps.ts)          -> source='seed_carousel'
//   - The top 50 apps (by real rating, userRatingCount>=50) of each of the
//     15 categories in GENRE_IDS (lib/genreIds.ts)         -> source='seed_category'
//
// A trackId that's both in the carousel AND in a category's top 50 stays
// 'seed_carousel' — that classification is resolved once, up front, before
// any row is written, so it's correct on the first pass and idempotent on
// a re-run (see buildTrackIdSource() below).
//
// This is intentionally self-contained (duplicates a little bit of logic
// from app/api/top-apps/route.ts and app/api/cron/sync-apps/route.ts)
// rather than importing from them, so this one-time script has zero
// chance of affecting either at runtime.
//
// This script is kept in the repo (unlike the throwaway debug/test
// scripts used elsewhere in this project) — it's the reproducible way to
// rebuild the seed if the tables are ever wiped or the project is
// recreated from scratch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CAROUSEL_APPS } from "../lib/carouselApps";
import { GENRE_IDS } from "../lib/genreIds";
import { lookupApps, AppLookupInfo } from "../lib/appLookup";
import { fetchReviews, Review } from "../lib/reviews";

// --- env loading -----------------------------------------------------
// Manual .env.local parsing instead of relying on Next's dev-server-only
// env loading or a Node CLI flag — this way `npx tsx scripts/seed-initial.ts`
// works standalone regardless of how it's invoked. Never overrides an
// already-set process.env value (e.g. from a real shell env in CI).
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

// --- constants ---------------------------------------------------------
const DEFAULT_COUNTRY = "cl";
// Same per-request pacing the cron uses — this run makes far more Apple
// requests in one go (~750+ apps) than a normal daily cron run, so it's
// even more important not to burst them.
const REQUEST_DELAY_MS = 400;
// Wider than /api/top-apps's pool of 100: that endpoint only needs 15
// survivors after the rating-count filter, this script needs 50, so it
// needs more headroom in the initial pool to reliably reach 50.
const CATEGORY_POOL_SIZE = 200;
const MIN_RATING_COUNT = 50;
const TOP_N_PER_CATEGORY = 50;
const LOOKUP_CHUNK_SIZE = 50;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- legacy chart parsing (same shape as app/api/top-apps/route.ts) ---
interface RawChartImage {
  label?: string;
  attributes?: { height?: string };
}
interface RawChartEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: { label?: string };
  "im:artist"?: { label?: string };
  "im:image"?: RawChartImage[];
}
interface ChartFeedResponse {
  feed?: { entry?: RawChartEntry[] };
}
interface ChartCandidate {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
}

function parseChartEntry(entry: RawChartEntry): ChartCandidate | null {
  const trackIdLabel = entry.id?.attributes?.["im:id"];
  const trackName = entry["im:name"]?.label;
  const artistName = entry["im:artist"]?.label;
  const images = entry["im:image"] ?? [];

  if (!trackIdLabel || !trackName || !artistName || images.length === 0) {
    return null;
  }

  const trackId = Number(trackIdLabel);
  if (!Number.isFinite(trackId)) {
    return null;
  }

  const bestImage = images.reduce((best, image) => {
    const height = Number(image.attributes?.height ?? 0);
    const bestHeight = Number(best.attributes?.height ?? 0);
    return height > bestHeight ? image : best;
  }, images[0]);

  if (!bestImage.label) {
    return null;
  }

  return { trackId, trackName, artistName, artworkUrl: bestImage.label };
}

async function fetchCategoryPool(genreId: number): Promise<ChartCandidate[]> {
  const url = `https://itunes.apple.com/${DEFAULT_COUNTRY}/rss/topfreeapplications/limit=${CATEGORY_POOL_SIZE}/genre=${genreId}/json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`chart feed responded with status ${response.status}`);
  }
  const data: ChartFeedResponse = await response.json();
  const rawEntry = data.feed?.entry;
  const entries: RawChartEntry[] = Array.isArray(rawEntry)
    ? rawEntry
    : rawEntry
    ? [rawEntry]
    : [];
  return entries
    .map(parseChartEntry)
    .filter((entry): entry is ChartCandidate => entry !== null);
}

// --- shared metadata cache ----------------------------------------------
// Populated incrementally as trackIds are discovered (carousel first, then
// each category's pool) so every unique trackId is looked up exactly once
// across the whole run, regardless of how many categories it shows up in.
const metadataCache = new Map<number, AppLookupInfo>();
// Fallback name/artwork for a trackId whose /lookup entry came back empty
// (app pulled from the Store, etc.) — sourced from wherever it was first
// discovered, so we can still seed a usable row instead of dropping it.
const fallbackInfo = new Map<
  number,
  { trackName: string; artistName?: string; artworkUrl100?: string }
>();

async function lookupUncached(trackIds: number[]): Promise<void> {
  const toFetch = trackIds.filter((id) => !metadataCache.has(id));
  if (toFetch.length === 0) return;

  for (const idsChunk of chunk(toFetch, LOOKUP_CHUNK_SIZE)) {
    try {
      const chunkMap = await lookupApps(idsChunk, DEFAULT_COUNTRY);
      for (const [trackId, info] of chunkMap) {
        metadataCache.set(trackId, info);
      }
    } catch (err) {
      console.error(`  ! metadata lookup chunk failed: ${errorMessage(err)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
}

function toReviewRows(trackId: number, reviews: Review[]) {
  const fetchedAt = new Date().toISOString();
  return reviews.map((review) => ({
    id: review.id,
    track_id: trackId,
    author: review.author,
    title: review.title,
    content: review.content,
    rating: review.rating,
    review_date: review.date,
    app_version: review.version,
    country: DEFAULT_COUNTRY,
    fetched_at: fetchedAt,
  }));
}

async function main() {
  const startedAt = Date.now();
  console.log("=== seed-initial: started ===");

  // ------------------------------------------------------------------
  // Step 1 — resolve source classification for every trackId up front.
  // Carousel is checked first and always wins; a trackId is only ever
  // marked 'seed_category' if it wasn't already claimed by the carousel.
  // This makes source assignment correct on the first run AND idempotent
  // on a re-run, without needing to read existing DB rows first.
  // ------------------------------------------------------------------
  const trackIdSource = new Map<number, "seed_carousel" | "seed_category">();
  for (const app of CAROUSEL_APPS) {
    trackIdSource.set(app.trackId, "seed_carousel");
    fallbackInfo.set(app.trackId, { trackName: app.name, artworkUrl100: app.artworkUrl100 });
  }

  console.log(`Step 1: looking up metadata for ${CAROUSEL_APPS.length} carousel apps...`);
  await lookupUncached(CAROUSEL_APPS.map((a) => a.trackId));

  const categorySurvivorCounts: Record<string, number> = {};
  const categoryPoolSizes: Record<string, number> = {};

  console.log(`Step 2: discovering top ${TOP_N_PER_CATEGORY} per category for ${Object.keys(GENRE_IDS).length} categories...`);
  for (const [genreName, genreId] of Object.entries(GENRE_IDS)) {
    process.stdout.write(`  - ${genreName}: fetching chart... `);
    let pool: ChartCandidate[];
    try {
      pool = await fetchCategoryPool(genreId);
    } catch (err) {
      console.log(`FAILED (${errorMessage(err)})`);
      categoryPoolSizes[genreName] = 0;
      categorySurvivorCounts[genreName] = 0;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    categoryPoolSizes[genreName] = pool.length;
    await sleep(REQUEST_DELAY_MS);

    await lookupUncached(pool.map((c) => c.trackId));

    const ranked = pool
      .map((candidate) => {
        const info = metadataCache.get(candidate.trackId);
        if (!info || info.averageUserRating == null || info.userRatingCount == null) {
          return null;
        }
        if (info.userRatingCount < MIN_RATING_COUNT) return null;
        return { candidate, averageUserRating: info.averageUserRating };
      })
      .filter((x): x is { candidate: ChartCandidate; averageUserRating: number } => x !== null)
      .sort((a, b) => b.averageUserRating - a.averageUserRating)
      .slice(0, TOP_N_PER_CATEGORY);

    categorySurvivorCounts[genreName] = ranked.length;
    console.log(`pool=${pool.length}, qualifying(>=${MIN_RATING_COUNT} ratings)=${ranked.length}`);

    for (const { candidate } of ranked) {
      if (!trackIdSource.has(candidate.trackId)) {
        trackIdSource.set(candidate.trackId, "seed_category");
      }
      if (!fallbackInfo.has(candidate.trackId)) {
        fallbackInfo.set(candidate.trackId, {
          trackName: candidate.trackName,
          artistName: candidate.artistName,
          artworkUrl100: candidate.artworkUrl,
        });
      }
    }
  }

  const uniqueTrackIds = Array.from(trackIdSource.keys());
  console.log(
    `Step 2 done: ${uniqueTrackIds.length} unique trackIds to seed (21 carousel + category picks, deduplicated)`
  );

  // ------------------------------------------------------------------
  // Step 3 — per-app: fetch reviews (paced), upsert apps + reviews.
  // ------------------------------------------------------------------
  console.log(`Step 3: fetching reviews and upserting ${uniqueTrackIds.length} apps...`);

  // Per-source/reviews counts are read back from the DB itself in Step 4
  // (more authoritative than in-memory bookkeeping) — only the failure
  // lists below need to be tracked as we go, since they're not otherwise
  // reconstructable from the final table state.
  let zeroReviewApps = 0;
  const reviewFetchFailed: number[] = [];
  const skippedNoMetadata: number[] = [];

  for (let i = 0; i < uniqueTrackIds.length; i++) {
    const trackId = uniqueTrackIds[i];
    const source = trackIdSource.get(trackId)!;
    const info = metadataCache.get(trackId);
    const fallback = fallbackInfo.get(trackId);

    const trackName = info?.trackName ?? fallback?.trackName;
    if (!trackName) {
      // No usable name from either the lookup or the discovery source —
      // can't satisfy the NOT NULL constraint, so this trackId is skipped
      // entirely rather than inserted with a placeholder.
      skippedNoMetadata.push(trackId);
      console.log(`  [${i + 1}/${uniqueTrackIds.length}] track_id=${trackId}: SKIPPED (no metadata available)`);
      continue;
    }

    let reviews: Review[] = [];
    let reviewsFetchOk = true;
    try {
      const result = await fetchReviews(String(trackId), DEFAULT_COUNTRY);
      reviews = result.reviews;
    } catch (err) {
      reviewsFetchOk = false;
      reviewFetchFailed.push(trackId);
      console.log(`  [${i + 1}/${uniqueTrackIds.length}] track_id=${trackId} "${trackName}": reviews FAILED (${errorMessage(err)})`);
    }

    const { error: appError } = await supabase.from("apps").upsert(
      {
        track_id: trackId,
        track_name: trackName,
        artist_name: info?.artistName ?? fallback?.artistName ?? null,
        artwork_url_100: info?.artworkUrl100 ?? fallback?.artworkUrl100 ?? null,
        primary_genre_name: info?.primaryGenreName ?? null,
        average_user_rating: info?.averageUserRating ?? null,
        user_rating_count: info?.userRatingCount ?? null,
        country: DEFAULT_COUNTRY,
        source,
        // Left null on a reviews-fetch failure (on purpose): the app still
        // gets seeded with its metadata now, but stays sorted first for
        // the regular cron's Part A to pick up and retry the reviews on
        // its next run, instead of this script needing its own retry loop.
        last_synced_at: reviewsFetchOk ? new Date().toISOString() : null,
      },
      { onConflict: "track_id" }
    );

    if (appError) {
      console.log(`  [${i + 1}/${uniqueTrackIds.length}] track_id=${trackId} "${trackName}": apps upsert FAILED (${appError.message})`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (reviewsFetchOk) {
      if (reviews.length > 0) {
        const { error: reviewsError } = await supabase
          .from("reviews")
          .upsert(toReviewRows(trackId, reviews), { onConflict: "id" });
        if (reviewsError) {
          console.log(`  [${i + 1}/${uniqueTrackIds.length}] track_id=${trackId} "${trackName}": reviews upsert FAILED (${reviewsError.message})`);
        }
      } else {
        zeroReviewApps++;
      }
      console.log(`  [${i + 1}/${uniqueTrackIds.length}] track_id=${trackId} "${trackName}" (${source}): OK, ${reviews.length} reviews`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  // ------------------------------------------------------------------
  // Step 4 — final counts straight from the DB (not just in-memory
  // counters), plus a rough per-category sanity check.
  // ------------------------------------------------------------------
  const { count: totalApps } = await supabase
    .from("apps")
    .select("*", { count: "exact", head: true });
  const { count: carouselCount } = await supabase
    .from("apps")
    .select("*", { count: "exact", head: true })
    .eq("source", "seed_carousel");
  const { count: categoryCount } = await supabase
    .from("apps")
    .select("*", { count: "exact", head: true })
    .eq("source", "seed_category");
  const { count: totalReviews } = await supabase
    .from("reviews")
    .select("*", { count: "exact", head: true });

  const elapsedMs = Date.now() - startedAt;

  console.log("\n=== seed-initial: summary ===");
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`apps table total: ${totalApps}`);
  console.log(`  source=seed_carousel: ${carouselCount}`);
  console.log(`  source=seed_category: ${categoryCount}`);
  console.log(`reviews table total: ${totalReviews}`);
  console.log(`(in-run) apps with 0 reviews: ${zeroReviewApps}`);
  console.log(`(in-run) apps skipped, no metadata at all: ${skippedNoMetadata.length} ${JSON.stringify(skippedNoMetadata)}`);
  console.log(`(in-run) apps where the reviews fetch failed (seeded with last_synced_at=null for the cron to retry): ${reviewFetchFailed.length} ${JSON.stringify(reviewFetchFailed)}`);
  console.log("\nPer-category pool size and qualifying (>=50 ratings) count:");
  for (const genreName of Object.keys(GENRE_IDS)) {
    console.log(`  ${genreName}: pool=${categoryPoolSizes[genreName]}, qualifying=${categorySurvivorCounts[genreName]}`);
  }
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
