// ALV-96 — one-time data reconciliation for the corruption root-caused in
// this same task: every write site that touched reviews_confirmed_empty
// (app/api/cron/sync-apps's Part A/B, lib/reviews.ts's live fallback,
// scripts/seed-initial.ts, scripts/seed-guaranteed.ts, and
// scripts/reconcile-empty-reviews.ts) used to base that flag on how many
// entries a single live iTunes RSS fetch returned, not on the true total
// already cached in `reviews`. A transient Apple glitch/rate-limit
// returning 0 entries on a REFRESH of an already-synced app (mostly Part
// A, ~110 apps/day) silently overwrote the flag to true, discarding the
// fact that real reviews from an earlier successful run were still
// sitting in the table untouched. By the time this was caught, ~50% of
// the `apps` table had the flag wrong.
//
// This is the mirror image of scripts/reconcile-empty-reviews.ts (ALV-87):
// that script finds apps that SHOULD be marked confirmed-empty but aren't;
// this one finds apps that ARE marked confirmed-empty but shouldn't be.
// Deliberately a separate script rather than folding into that one — the
// two walk the `apps` table in opposite directions and would only
// complicate each other's already-careful pagination logic.
//
// Pure local correction: no Apple calls. Every review a corrected app has
// is already sitting in `reviews` — this only fixes the `apps` flag to
// match data already in Supabase, so it's fast and can't itself introduce
// a live-fetch glitch.
//
// Run manually:
//
//   npx tsx scripts/reconcile-stale-empty-flags.ts
//
// Safe to re-run: an app already consistent (reviews_confirmed_empty
// correctly false, or genuinely true with 0 cached rows) is left alone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { supabaseTimeoutSignal } from "../lib/supabaseTimeout";

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

// Bulk UPDATE ... WHERE track_id IN (...) — chunked so no single request's
// IN-list (and its query-string-encoded size) gets unwieldy, independent
// of the 5s per-query abortSignal timeout added in ALV-95.
const UPDATE_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log("=== reconcile-stale-empty-flags: started ===");

  // Step 1 — every app currently marked reviews_confirmed_empty = true.
  // Paginated with .range(), not a single .select() — Supabase caps a
  // single request at 1000 rows by default, and this count was already
  // observed at ~1000 (right at that cap) during investigation, so a
  // naive unpaginated query here would risk silently truncating the exact
  // list this whole script depends on.
  const flagged: { track_id: number; track_name: string }[] = [];
  const PAGE_SIZE = 1000;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: flaggedError } = await supabase
      .from("apps")
      .select("track_id, track_name")
      .eq("reviews_confirmed_empty", true)
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(supabaseTimeoutSignal());
    if (flaggedError) {
      console.error("Failed to query confirmed-empty apps:", flaggedError.message);
      process.exit(1);
    }
    flagged.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  console.log(`Step 1: ${flagged.length} apps currently marked reviews_confirmed_empty=true`);

  const { count: totalApps } = await supabase
    .from("apps")
    .select("*", { count: "exact", head: true })
    .abortSignal(supabaseTimeoutSignal());

  // Step 2 — page through the WHOLE reviews table (not .in(candidateIds)
  // — same reasoning as reconcile-empty-reviews.ts: Supabase caps a
  // single request at 1000 rows, and `reviews` has tens of thousands, so
  // a naive .in() query would silently miss most of the table).
  const hasReviews = new Set<number>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from("reviews")
      .select("track_id")
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(supabaseTimeoutSignal());
    if (pageError) {
      console.error(`Failed to page reviews at offset ${offset}:`, pageError.message);
      process.exit(1);
    }
    for (const row of page ?? []) {
      hasReviews.add(row.track_id as number);
    }
    if (!page || page.length < PAGE_SIZE) break;
  }
  console.log(`Step 2: ${hasReviews.size} distinct track_ids have at least one row in reviews (paged through the full table)`);

  // Step 3 — the actual mismatch: flagged empty, but real reviews exist.
  const stale = flagged.filter((a) => hasReviews.has(a.track_id));
  console.log(`Step 3: ${stale.length} apps are stale (reviews_confirmed_empty=true but have real cached reviews) out of ${totalApps} total apps`);

  if (stale.length === 0) {
    console.log("Nothing to reconcile.");
    return;
  }

  // Step 4 — bulk-correct: reviews_confirmed_empty -> false, chunked.
  let corrected = 0;
  let failed = 0;
  const staleIds = stale.map((a) => a.track_id);
  for (const idsChunk of chunk(staleIds, UPDATE_CHUNK_SIZE)) {
    const { error, count } = await supabase
      .from("apps")
      .update({ reviews_confirmed_empty: false }, { count: "exact" })
      .in("track_id", idsChunk)
      .abortSignal(supabaseTimeoutSignal());
    if (error) {
      failed += idsChunk.length;
      console.error(`  ! batch update FAILED for ${idsChunk.length} apps: ${error.message}`);
    } else {
      corrected += count ?? idsChunk.length;
      console.log(`  corrected ${count ?? idsChunk.length} apps (batch of ${idsChunk.length})`);
    }
  }

  console.log("\n=== reconcile-stale-empty-flags: summary ===");
  console.log(`Stale apps found: ${stale.length}`);
  console.log(`Corrected: ${corrected}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("Re-run this script to retry the failed batch(es) — updates are idempotent.");
  }
  console.log("=== done ===");
}

main();
