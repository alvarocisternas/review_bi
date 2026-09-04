// ALV-87 — retroactive reconciliation over the whole `apps` table.
//
// Finds every app stuck in the exact broken state ALV-85 uncovered for
// Santander Chile: last_synced_at is set (so nothing currently retries
// it), reviews_confirmed_empty isn't true (so it was never actually
// *confirmed* empty by a fetch+save that both succeeded), and it has 0
// rows in `reviews`. For each one, retries the live fetch and reconciles
// the real state — see main() below for exactly what "corrupt" means and
// how each outcome is handled.
//
// Run manually:
//
//   npx tsx scripts/reconcile-empty-reviews.ts
//
// Safe to re-run: apps that get reconciled (either direction) are no
// longer "corrupt" per the query above, so a second run only touches
// whatever's left (failures from the previous run, or newly-introduced
// cases).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { supabaseTimeoutSignal } from "../lib/supabaseTimeout";
// fetchReviewsLive/toReviewInsertRows are imported dynamically inside
// main() instead of statically here — see scripts/seed-initial.ts's
// identical note for why (lib/reviews.ts pulls in lib/supabase.ts at
// module scope, which needs process.env populated by loadEnvLocal()
// first; a static import here would get hoisted ahead of that).

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

interface AppRow {
  track_id: number;
  track_name: string;
  country: string | null;
}

async function main() {
  const { fetchReviewsLive, toReviewInsertRows } = await import("../lib/reviews");

  console.log("=== reconcile-empty-reviews: started ===");

  // Step 1 — candidates: last_synced_at IS NOT NULL AND
  // reviews_confirmed_empty IS NOT TRUE (covers both false and, though the
  // column is NOT NULL DEFAULT false so it shouldn't occur in practice,
  // null too — .not(col, "is", true) is NOT (col IS TRUE), true for both).
  const { data: candidateRows, error: candidateError } = await supabase
    .from("apps")
    .select("track_id, track_name, country")
    .not("last_synced_at", "is", null)
    .not("reviews_confirmed_empty", "is", true)
    .abortSignal(supabaseTimeoutSignal());

  if (candidateError) {
    console.error("Failed to query candidate apps:", candidateError.message);
    process.exit(1);
  }

  const candidates = (candidateRows ?? []) as AppRow[];
  console.log(`Step 1: ${candidates.length} apps pass last_synced_at/reviews_confirmed_empty filter`);

  // Step 2 — narrow to apps with genuinely 0 rows in `reviews`.
  //
  // IMPORTANT: this must page through the whole `reviews` table with
  // .range(), not a single .select("track_id").in(candidateIds) — Supabase
  // caps a single request at 1000 rows by default, and `reviews` has well
  // over 1000 rows total (~26k), so a handful of popular apps' 50 reviews
  // each fill that cap before most of the candidate set is even
  // represented. A first version of this script did exactly that and
  // produced a false "670 corrupt apps" — confirmed wrong by spot-checking
  // apps (e.g. Fintual) that were live-verified minutes earlier to already
  // have 50 real cached reviews, yet still showed up as "0 rows" as an
  // artifact of the truncated set. Paginating the full table, not just the
  // candidate ids, avoids that cap entirely.
  const hasReviews = new Set<number>();
  const PAGE_SIZE = 1000;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from("reviews")
      .select("track_id")
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(supabaseTimeoutSignal());
    if (pageError) {
      console.error(`Failed to page reviews at offset ${offset}:`, pageError.message);
      break;
    }
    for (const row of page ?? []) {
      hasReviews.add(row.track_id as number);
    }
    if (!page || page.length < PAGE_SIZE) break;
  }
  console.log(`Step 2: ${hasReviews.size} distinct track_ids have at least one row in reviews (paged through the full table)`);

  const corrupt = candidates.filter((c) => !hasReviews.has(c.track_id));
  console.log(`Step 2: ${corrupt.length} apps are actually corrupt (0 rows in reviews)`);

  if (corrupt.length === 0) {
    console.log("Nothing to reconcile.");
    return;
  }

  // Step 3 — reconcile each one.
  const recovered: { trackId: number; trackName: string; reviewCount: number }[] = [];
  const confirmedEmpty: { trackId: number; trackName: string }[] = [];
  const failed: { trackId: number; trackName: string; error: string }[] = [];

  for (let i = 0; i < corrupt.length; i++) {
    const app = corrupt[i];
    const country = app.country ?? DEFAULT_COUNTRY;

    try {
      const { reviews } = await fetchReviewsLive(String(app.track_id), country, 1);

      if (reviews.length > 0) {
        const { error: reviewsError } = await supabase
          .from("reviews")
          .upsert(toReviewInsertRows(app.track_id, country, reviews), { onConflict: "id" })
          .abortSignal(supabaseTimeoutSignal());
        if (reviewsError) {
          throw new Error(`reviews upsert failed: ${reviewsError.message}`);
        }
      }

      // Reached only once the reviews (if any) are safely saved — mirrors
      // every other ALV-85-safe write site: reviews_confirmed_empty is
      // only ever set together with a confirmed-successful fetch+save.
      const { error: appError } = await supabase
        .from("apps")
        .update({
          last_synced_at: new Date().toISOString(),
          reviews_confirmed_empty: true,
        })
        .eq("track_id", app.track_id)
        .abortSignal(supabaseTimeoutSignal());
      if (appError) {
        throw new Error(`apps update failed: ${appError.message}`);
      }

      if (reviews.length > 0) {
        recovered.push({ trackId: app.track_id, trackName: app.track_name, reviewCount: reviews.length });
        console.log(`  [${i + 1}/${corrupt.length}] track_id=${app.track_id} "${app.track_name}": RECOVERED ${reviews.length} real reviews`);
      } else {
        confirmedEmpty.push({ trackId: app.track_id, trackName: app.track_name });
        console.log(`  [${i + 1}/${corrupt.length}] track_id=${app.track_id} "${app.track_name}": confirmed genuinely empty`);
      }
    } catch (err) {
      const message = errorMessage(err);
      failed.push({ trackId: app.track_id, trackName: app.track_name, error: message });
      console.log(`  [${i + 1}/${corrupt.length}] track_id=${app.track_id} "${app.track_name}": FAILED (${message}) — left untouched for a future run`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n=== reconcile-empty-reviews: summary ===");
  console.log(`Corrupt apps found: ${corrupt.length}`);
  console.log(`Recovered real reviews: ${recovered.length}`);
  for (const r of recovered) {
    console.log(`  - track_id=${r.trackId} "${r.trackName}": ${r.reviewCount} reviews`);
  }
  console.log(`Confirmed genuinely empty: ${confirmedEmpty.length}`);
  for (const c of confirmedEmpty) {
    console.log(`  - track_id=${c.trackId} "${c.trackName}"`);
  }
  console.log(`Failed (left untouched): ${failed.length}`);
  for (const f of failed) {
    console.log(`  - track_id=${f.trackId} "${f.trackName}": ${f.error}`);
  }
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
