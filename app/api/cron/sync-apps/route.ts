import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchReviewsLive, toReviewInsertRows } from "@/lib/reviews";
import { lookupApps, AppLookupInfo } from "@/lib/appLookup";

// Vercel Hobby + Fluid Compute's hard ceiling is 300s; 280 leaves a 20s
// safety margin on top of that. TOTAL_TIME_BUDGET_MS below (270s) stays
// under this on its own — maxDuration is the outer safety net in case the
// in-code budget check gets skipped somehow (e.g. a hang inside a single
// fetch/upsert call that never reaches the next elapsed() check).
export const maxDuration = 280;

const DEFAULT_COUNTRY = "cl";

// --- Pacing --------------------------------------------------------------
// Delay between each per-app iTunes RSS reviews request — within the
// 300-500ms range asked for. This is the endpoint that actually rate-
// limited us earlier in this project, so it's the one that gets paced;
// the /lookup metadata calls below are batched (a handful of requests
// covering the whole run, not one per app) and don't need per-app pacing.
const REQUEST_DELAY_MS = 400;

// --- Part A: fixed-set rotation -------------------------------------------
// The fixed set is the carousel (21 apps) + top 50 of each of the ~15
// categories tracked by /api/top-apps + the guaranteed list
// (lib/guaranteedApps.ts — apps that must stay synced regardless of
// whether they'd naturally place in their category's top 50) ≈ 750+ apps
// total. Refreshing 110 of them per daily run means every app cycles back
// roughly every 750 / 110 ≈ 6.8 days — "about once a week", as asked.
const FIXED_SET_BATCH_SIZE = 110;
// iTunes' /lookup takes a comma-separated id list with no documented hard
// cap, but chunking keeps each individual request modest instead of
// firing one 110-id request — a few batched calls, not one per app.
const LOOKUP_CHUNK_SIZE = 50;
// Even in a worst case where 110 apps takes far longer than expected,
// Part A gives up its turn here so Part B is guaranteed some time.
const PART_A_TIME_CAP_MS = 200_000;

// --- Part B: organic queue -------------------------------------------
// Stop auto-retrying an organic app after this many failed sync attempts.
// It stays in pending_apps (visible for manual inspection / a future
// cleanup task) but is excluded from the query below, so a permanently
// broken trackId doesn't eat pacing budget on every run forever.
const PENDING_MAX_ATTEMPTS = 5;
// Sane ceiling on how many pending apps to attempt in one run, independent
// of the time budget — mainly guards the case where Part A has nothing to
// do yet (fixed set not seeded, as today) and would otherwise let Part B
// run against an unexpectedly large queue.
const PENDING_BATCH_SAFETY_CAP = 300;

// --- Overall budget --------------------------------------------------
// 30s under Vercel's 300s ceiling — leaves room for cold start, the
// Supabase round trips themselves, and serializing the summary response.
const TOTAL_TIME_BUDGET_MS = 270_000;

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

interface FixedSetAppRow {
  track_id: number;
  country: string | null;
  track_name: string;
}

interface PendingAppRow {
  track_id: number;
  attempts: number;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // --- Auth ----------------------------------------------------------
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[sync-apps] CRON_SECRET is not configured on the server");
    return NextResponse.json(
      { error: "CRON_SECRET no configurado en el servidor" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.warn("[sync-apps] Rejected request with missing/invalid Authorization header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[sync-apps] === Run started ===");

  // ==========================================================================
  // PARTE A — refresh rotativo del set fijo (carrusel + top por categoría)
  // ==========================================================================
  let fixedCandidates = 0;
  let fixedRefreshed = 0;
  let fixedFailed = 0;

  const { data: fixedAppsData, error: fixedSelectError } = await supabase
    .from("apps")
    .select("track_id, country, track_name")
    .in("source", ["seed_carousel", "seed_category", "seed_guaranteed"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(FIXED_SET_BATCH_SIZE);

  if (fixedSelectError) {
    console.error("[sync-apps] Part A: failed to query fixed-set apps:", fixedSelectError.message);
  } else {
    const fixedApps = (fixedAppsData ?? []) as FixedSetAppRow[];
    fixedCandidates = fixedApps.length;
    console.log(`[sync-apps] Part A: ${fixedCandidates} fixed-set apps due for refresh (batch size ${FIXED_SET_BATCH_SIZE})`);

    // Batched metadata lookup up front, chunked — a handful of Apple
    // requests covering the whole batch instead of one per app. Grouped by
    // country first: /lookup's rating numbers are storefront-specific (a
    // real, confirmed discrepancy — see lib/appLookup.ts), and while every
    // app in this project uses country='cl' today, this stays correct if
    // that ever changes instead of silently mixing storefronts in one call.
    const metadataMap = new Map<number, AppLookupInfo>();
    const trackIdsByCountry = new Map<string, number[]>();
    for (const app of fixedApps) {
      const country = app.country ?? DEFAULT_COUNTRY;
      const list = trackIdsByCountry.get(country) ?? [];
      list.push(app.track_id);
      trackIdsByCountry.set(country, list);
    }
    for (const [country, trackIds] of trackIdsByCountry) {
      for (const idsChunk of chunk(trackIds, LOOKUP_CHUNK_SIZE)) {
        try {
          const chunkMap = await lookupApps(idsChunk, country);
          for (const [trackId, info] of chunkMap) {
            metadataMap.set(trackId, info);
          }
        } catch (err) {
          console.error("[sync-apps] Part A: metadata lookup chunk failed:", errorMessage(err));
        }
      }
    }
    console.log(`[sync-apps] Part A: metadata resolved for ${metadataMap.size}/${fixedCandidates} apps`);

    for (const app of fixedApps) {
      if (elapsed() > PART_A_TIME_CAP_MS) {
        console.log(
          `[sync-apps] Part A: time cap reached (${elapsed()}ms) — stopping early, ${fixedRefreshed} refreshed of ${fixedCandidates} candidates. Unrefreshed apps keep their old last_synced_at, so they'll be first in line on the next run.`
        );
        break;
      }

      const country = app.country ?? DEFAULT_COUNTRY;

      try {
        // fetchReviewsLive, not fetchReviews — this loop's whole job is
        // refreshing the cache from Apple; going through the cache-first
        // fetchReviews would just read back what's already in `reviews`
        // for any app that's been synced before, and never actually check
        // for new reviews.
        const { reviews } = await fetchReviewsLive(String(app.track_id), country, 1);

        if (reviews.length > 0) {
          const { error: reviewsError } = await supabase
            .from("reviews")
            .upsert(toReviewInsertRows(app.track_id, country, reviews), { onConflict: "id" });
          if (reviewsError) {
            throw new Error(`reviews upsert failed: ${reviewsError.message}`);
          }
        }

        // Only reached once the reviews above are safely saved (or there
        // were none to save) — last_synced_at/reviews_confirmed_empty are
        // ALV-85's fix, so they must only ever be written together with a
        // confirmed-successful reviews step, never on their own.
        //
        // Partial merge-update — columns not included here are left
        // untouched by PostgREST's upsert on the conflict/update path.
        // track_name is the one exception: Postgres validates NOT NULL
        // constraints against the row being proposed for INSERT before it
        // even checks for a conflict, so an upsert payload missing a
        // NOT NULL column fails outright even when it only ever takes the
        // UPDATE branch (confirmed with a real failing request during this
        // task's manual testing). Re-sending the already-known track_name
        // (refreshed if the lookup returned a newer one, unchanged
        // otherwise) satisfies that without touching anything else.
        const info = metadataMap.get(app.track_id);
        const appUpdate: Record<string, unknown> = {
          track_id: app.track_id,
          track_name: info?.trackName ?? app.track_name,
          last_synced_at: new Date().toISOString(),
          reviews_confirmed_empty: reviews.length === 0,
        };
        if (info?.averageUserRating != null) {
          appUpdate.average_user_rating = info.averageUserRating;
        }
        if (info?.userRatingCount != null) {
          appUpdate.user_rating_count = info.userRatingCount;
        }

        const { error: appError } = await supabase
          .from("apps")
          .upsert(appUpdate, { onConflict: "track_id" });
        if (appError) {
          throw new Error(`apps upsert failed: ${appError.message}`);
        }

        fixedRefreshed++;
        console.log(`[sync-apps] Part A: OK track_id=${app.track_id} (${reviews.length} reviews)`);
      } catch (err) {
        fixedFailed++;
        console.error(`[sync-apps] Part A: FAILED track_id=${app.track_id}:`, errorMessage(err));
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(
    `[sync-apps] Part A finished: ${fixedRefreshed} refreshed, ${fixedFailed} failed, ${elapsed()}ms elapsed total`
  );

  // ==========================================================================
  // PARTE B — drenar pending_apps (apps orgánicas nuevas)
  // ==========================================================================
  let pendingCandidates = 0;
  let pendingAttempted = 0;
  let pendingProcessed = 0;
  let pendingFailed = 0;

  const { data: pendingAppsData, error: pendingSelectError } = await supabase
    .from("pending_apps")
    .select("track_id, attempts")
    .lt("attempts", PENDING_MAX_ATTEMPTS)
    .order("requested_at", { ascending: true })
    .limit(PENDING_BATCH_SAFETY_CAP);

  if (pendingSelectError) {
    console.error("[sync-apps] Part B: failed to query pending_apps:", pendingSelectError.message);
  } else {
    const pendingApps = (pendingAppsData ?? []) as PendingAppRow[];
    pendingCandidates = pendingApps.length;
    console.log(
      `[sync-apps] Part B: ${pendingCandidates} pending apps eligible (attempts < ${PENDING_MAX_ATTEMPTS}), remaining budget ${TOTAL_TIME_BUDGET_MS - elapsed()}ms`
    );

    for (const pending of pendingApps) {
      if (elapsed() > TOTAL_TIME_BUDGET_MS) {
        console.log(
          `[sync-apps] Part B: time budget exhausted (${elapsed()}ms) — stopping early, ${pendingAttempted} attempted of ${pendingCandidates} candidates`
        );
        break;
      }

      pendingAttempted++;

      try {
        const metadataMap = await lookupApps([pending.track_id], DEFAULT_COUNTRY);
        const info = metadataMap.get(pending.track_id);
        if (!info) {
          throw new Error("trackId not found in iTunes Lookup");
        }

        // fetchReviewsLive here too, same reasoning as Part A above —
        // onboarding an organic app should always hit Apple directly.
        const { reviews } = await fetchReviewsLive(String(pending.track_id), DEFAULT_COUNTRY, 1);

        // Reviews saved BEFORE the apps upsert on purpose (this order was
        // flipped during the ALV-85 fix): if the reviews save fails below,
        // it throws and we never reach the apps upsert at all, so
        // last_synced_at/reviews_confirmed_empty never get written on a
        // partial success — same bug class as Santander Chile, just in
        // this code path instead of the seed script.
        if (reviews.length > 0) {
          const { error: reviewsError } = await supabase
            .from("reviews")
            .upsert(toReviewInsertRows(pending.track_id, DEFAULT_COUNTRY, reviews), { onConflict: "id" });
          if (reviewsError) {
            throw new Error(`reviews upsert failed: ${reviewsError.message}`);
          }
        }

        // Full row — this app doesn't exist in `apps` yet. Only reached
        // once the reviews above are safely saved (or there were none).
        const { error: appError } = await supabase.from("apps").upsert(
          {
            track_id: pending.track_id,
            track_name: info.trackName,
            artist_name: info.artistName ?? null,
            artwork_url_100: info.artworkUrl100 ?? null,
            primary_genre_name: info.primaryGenreName ?? null,
            average_user_rating: info.averageUserRating ?? null,
            user_rating_count: info.userRatingCount ?? null,
            country: DEFAULT_COUNTRY,
            source: "organic",
            last_synced_at: new Date().toISOString(),
            reviews_confirmed_empty: reviews.length === 0,
          },
          { onConflict: "track_id" }
        );
        if (appError) {
          throw new Error(`apps upsert failed: ${appError.message}`);
        }

        // Successfully onboarded — even with 0 reviews, per the Fintoc Me
        // case — so it's done with the queue regardless of review count.
        const { error: deleteError } = await supabase
          .from("pending_apps")
          .delete()
          .eq("track_id", pending.track_id);
        if (deleteError) {
          throw new Error(`pending_apps delete failed: ${deleteError.message}`);
        }

        pendingProcessed++;
        console.log(`[sync-apps] Part B: OK track_id=${pending.track_id} onboarded (${reviews.length} reviews)`);
      } catch (err) {
        pendingFailed++;
        const message = errorMessage(err);
        console.error(`[sync-apps] Part B: FAILED track_id=${pending.track_id}:`, message);

        const { error: updateError } = await supabase
          .from("pending_apps")
          .update({ attempts: pending.attempts + 1, last_error: message })
          .eq("track_id", pending.track_id);
        if (updateError) {
          console.error(
            `[sync-apps] Part B: failed to record attempt for track_id=${pending.track_id}:`,
            updateError.message
          );
        }
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(
    `[sync-apps] Part B finished: ${pendingProcessed} processed, ${pendingFailed} failed, ${elapsed()}ms elapsed total`
  );

  const summary = {
    elapsedMs: elapsed(),
    fixedSet: {
      candidates: fixedCandidates,
      refreshed: fixedRefreshed,
      failed: fixedFailed,
    },
    pendingQueue: {
      candidates: pendingCandidates,
      attempted: pendingAttempted,
      processed: pendingProcessed,
      failed: pendingFailed,
      remaining: pendingCandidates - pendingAttempted,
    },
  };

  console.log("[sync-apps] === Run finished ===", JSON.stringify(summary));

  return NextResponse.json(summary);
}
