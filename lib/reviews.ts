import { supabase } from "@/lib/supabase";

// ALV-94: caps the outgoing RSS call so a hung iTunes response can't ride
// a caller's serverless function to its own platform-level limit. Every
// caller of fetchReviewsLive already wraps it in a try/catch (or leaves it
// uncaught to propagate to one that does — see fetchReviews below) — a
// timeout is just another way for the fetch to fail, so this needs no new
// error-classification anywhere it's called from.
const UPSTREAM_TIMEOUT_MS = 10_000;

interface RawEntry {
  // Apple's per-review permalink, e.g.
  // "https://itunes.apple.com/us/review?id=123&type=Purple%20Software" —
  // used as the real, stable id for upserting into the reviews table
  // (see app/api/cron/sync-apps) so re-syncing never duplicates a review.
  id?: { label?: string };
  author?: { name?: { label?: string } };
  title?: { label?: string };
  content?: { label?: string };
  "im:rating"?: { label?: string };
  updated?: { label?: string };
  "im:version"?: { label?: string };
}

interface RssResponse {
  feed: {
    entry?: RawEntry[];
  };
}

export interface Review {
  id: string;
  author: string;
  title: string;
  content: string;
  rating: number;
  date: string;
  version: string;
}

export interface ReviewsResult {
  reviews: Review[];
  page: number;
  country: string;
}

interface CachedReviewRow {
  id: string;
  author: string | null;
  title: string | null;
  content: string | null;
  rating: number | null;
  review_date: string | null;
  app_version: string | null;
}

function fromCachedRow(row: CachedReviewRow): Review {
  return {
    id: row.id,
    author: row.author ?? "",
    title: row.title ?? "",
    content: row.content ?? "",
    rating: row.rating ?? 0,
    date: row.review_date ?? "",
    version: row.app_version ?? "",
  };
}

/**
 * Builds `reviews` insert/upsert rows from live-fetched Review objects.
 * Shared by every write site (this file's own fallback, the sync cron,
 * the seed script) so the column mapping never drifts between them.
 * `fetched_at` is set explicitly on every call (not left to the column
 * default, which only fires on insert) so it always reflects the last
 * time this review was confirmed to still exist on iTunes.
 */
export function toReviewInsertRows(trackId: number, country: string, reviews: Review[]) {
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
    country,
    fetched_at: fetchedAt,
  }));
}

/**
 * Fetches and parses reviews live from the iTunes customer reviews RSS
 * feed, unconditionally — no cache read at all.
 *
 * Exported (not just fetchReviews' internal fallback path) for callers
 * whose whole job IS refreshing the cache with live data — the sync cron
 * (app/api/cron/sync-apps) and the seed script (scripts/seed-initial.ts).
 * Those must NOT go through fetchReviews: calling the cache-first version
 * from a refresh job would just read back what's already cached and never
 * actually check Apple for new reviews — found as a real bug during
 * end-to-end testing, where the cron's "refresh" step for an already-
 * synced app turned out to be a same-data round trip through its own
 * cache, silently defeating the whole point of the daily rotation.
 *
 * Throws if the request to iTunes fails — callers decide how to surface that.
 */
export async function fetchReviewsLive(
  trackId: string,
  country: string,
  page: number
): Promise<ReviewsResult> {
  // Always include the country segment, even for "us". This used to be
  // omitted for "us" as a micro-optimization; while investigating a
  // separate issue (Apple rate-limiting this session's IP on this legacy
  // RSS endpoint, causing feed.entry to come back empty for known-good
  // trackIds), the /us/-prefixed URL was the more reliable of the two in
  // side-by-side tests. That said, the rate-limiting itself was the
  // dominant effect and made it hard to fully isolate whether the segment
  // matters on its own — this is kept as the safer, more explicit form,
  // not because the omission was proven to be the root cause.
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${trackId}/page=${page}/sortby=mostrecent/json`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`iTunes RSS responded with status ${response.status}`);
  }

  const data: RssResponse = await response.json();

  const rawEntry = data.feed?.entry;
  // Apple's XML→JSON conversion collapses a single-item feed into an object
  // instead of an array — normalize so downstream logic always sees an array.
  const entries: RawEntry[] = Array.isArray(rawEntry)
    ? rawEntry
    : rawEntry
    ? [rawEntry]
    : [];

  const reviews: Review[] = entries
    .filter((entry) => {
      const ratingLabel = entry["im:rating"]?.label;
      const authorName = entry.author?.name?.label;
      const idLabel = entry.id?.label;
      return ratingLabel != null && authorName != null && idLabel != null;
    })
    .map((entry) => ({
      id: entry.id!.label!,
      author: entry.author!.name!.label!,
      title: entry.title?.label ?? "",
      content: entry.content?.label ?? "",
      rating: Number(entry["im:rating"]!.label),
      date: entry.updated?.label ?? "",
      version: entry["im:version"]?.label ?? "",
    }));

  return { reviews, page, country };
}

/**
 * Reviews for a trackId, preferring the Supabase cache over a live iTunes
 * RSS call. Behavior:
 *
 *   1. If `reviews` has any cached rows for this trackId, return them
 *      directly — no live call at all. (Only filtered by track_id, not
 *      country — every row in this project's cache is country='cl' today,
 *      same assumption the search-app/top-apps migrations made.)
 *   2. If there are no cached rows, check `apps`:
 *        a. Row exists AND reviews_confirmed_empty is true -> a fetch
 *           (and, if there was anything to save, its save) already
 *           completed successfully in full and genuinely found 0 reviews
 *           (e.g. an app like The Economist in this project's real data)
 *           — return { reviews: [] } directly, no live call.
 *
 *           This is deliberately NOT keyed on last_synced_at alone
 *           (ALV-85): Santander Chile had last_synced_at set from the
 *           initial seed run, but 0 rows in `reviews` and real reviews on
 *           Apple — its live fetch during that run returned an empty
 *           result (HTTP 200, no exception) for reasons indistinguishable
 *           at the time from a genuinely empty app. reviews_confirmed_empty
 *           is only ever set true by a write path that also confirmed the
 *           reviews (if any) were actually saved — see toReviewInsertRows'
 *           callers in this file and app/api/cron/sync-apps.
 *        b. Row doesn't exist, or exists with reviews_confirmed_empty
 *           still false (a freshly-added 'organic' app from
 *           /api/search-app, or one whose last sync attempt didn't fully
 *           confirm either way) -> fall back to the live RSS fetch
 *           (fetchReviewsLive).
 *
 *           If the app row already exists, the fetched reviews (or the
 *           confirmed-empty result) are saved immediately here — no need
 *           to wait for the cron — and reviews_confirmed_empty/
 *           last_synced_at are only written once that save has actually
 *           succeeded (or there was nothing to save). A save failure
 *           leaves both untouched, same reasoning as Santander: never
 *           mark "confirmed" on a partial success.
 *
 *           If the app row doesn't exist at all, there's no metadata
 *           (track_name etc.) to create one here, and `reviews.track_id`
 *           has a foreign key to `apps.track_id` — so reviews can't be
 *           inserted yet either. That case (and any save failure above)
 *           falls back to queuing the trackId in pending_apps so the
 *           cron fully onboards it (metadata + reviews) on its next run.
 *           The upsert payload is just { track_id }, so on a conflict
 *           it's a no-op that doesn't reset an existing row's
 *           attempts/last_error/requested_at — safe to call even if
 *           already queued.
 *
 *      A Supabase error at any point in this cache-lookup path is treated
 *      the same as "not found" and falls through to the live fetch, so a
 *      transient DB hiccup degrades to the old behavior instead of
 *      breaking the response.
 *
 * Throws only if the live fallback itself fails — same contract as
 * before this migration, callers decide how to surface that (502).
 */
export async function fetchReviews(
  trackId: string,
  country: string = "cl",
  page: number = 1
): Promise<ReviewsResult> {
  const trackIdNum = Number(trackId);

  const { data: cachedRows, error: cacheError } = await supabase
    .from("reviews")
    .select("id, author, title, content, rating, review_date, app_version")
    .eq("track_id", trackIdNum);

  if (cacheError) {
    console.error(`[reviews] cache query failed for track_id=${trackId}:`, cacheError.message);
  } else if (cachedRows && cachedRows.length > 0) {
    console.log(`[reviews] track_id=${trackId} served from cache (${cachedRows.length} reviews)`);
    return {
      reviews: (cachedRows as CachedReviewRow[]).map(fromCachedRow),
      page,
      country,
    };
  }

  const { data: appRow, error: appError } = await supabase
    .from("apps")
    .select("track_id, reviews_confirmed_empty")
    .eq("track_id", trackIdNum)
    .maybeSingle();

  if (!appError && appRow && appRow.reviews_confirmed_empty === true) {
    console.log(`[reviews] track_id=${trackId} known, confirmed-empty, genuinely 0 reviews`);
    return { reviews: [], page, country };
  }

  console.log(`[reviews] track_id=${trackId} not cached/confirmed-empty — falling back to live RSS`);
  const liveResult = await fetchReviewsLive(trackId, country, page);

  // Best-effort immediate cache write, only possible when the app already
  // has a row (see the foreign-key note above) — most of the time it does,
  // since /api/search-app creates that row before a user can ever reach
  // an analysis/reviews call for a trackId.
  let savedNow = false;
  if (!appError && appRow) {
    let reviewsSavedOk = true;
    if (liveResult.reviews.length > 0) {
      const { error: reviewsError } = await supabase
        .from("reviews")
        .upsert(toReviewInsertRows(trackIdNum, country, liveResult.reviews), { onConflict: "id" });
      if (reviewsError) {
        reviewsSavedOk = false;
        console.error(`[reviews] Failed to save live-fetched reviews for track_id=${trackId}:`, reviewsError.message);
      }
    }

    if (reviewsSavedOk) {
      const { error: updateError } = await supabase
        .from("apps")
        .update({
          last_synced_at: new Date().toISOString(),
          reviews_confirmed_empty: liveResult.reviews.length === 0,
        })
        .eq("track_id", trackIdNum);
      if (updateError) {
        console.error(`[reviews] Failed to update apps for track_id=${trackId}:`, updateError.message);
      } else {
        savedNow = true;
        console.log(`[reviews] track_id=${trackId} saved immediately (${liveResult.reviews.length} reviews)`);
      }
    }
  }

  // Only queue for the cron when this request didn't already fully save
  // the result itself — avoids a redundant re-fetch on the next cron run.
  if (!savedNow) {
    const { error: pendingError } = await supabase
      .from("pending_apps")
      .upsert({ track_id: trackIdNum }, { onConflict: "track_id" });
    if (pendingError) {
      console.error(`[reviews] Failed to queue track_id=${trackId} in pending_apps:`, pendingError.message);
    } else {
      console.log(`[reviews] track_id=${trackId} queued in pending_apps for full onboarding`);
    }
  }

  return liveResult;
}
