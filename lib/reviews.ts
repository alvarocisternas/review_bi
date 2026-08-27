import { supabase } from "@/lib/supabase";

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

  const response = await fetch(url);

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
 *        a. Row exists AND last_synced_at is set -> this app has already
 *           been synced and genuinely has 0 reviews (e.g. Fintoc Me) —
 *           return { reviews: [] } directly, no live call.
 *        b. Row doesn't exist, or exists with last_synced_at still null
 *           (a freshly-added 'organic' app from /api/search-app that
 *           hasn't been picked up by the sync cron yet) -> fall back to
 *           the live RSS fetch (fetchReviewsLive), return its result to
 *           the caller as before, AND upsert the trackId into
 *           pending_apps so the cron fully onboards it (metadata +
 *           reviews) on its next run. The upsert payload is just
 *           { track_id }, so on a conflict it's a no-op that doesn't
 *           reset an existing row's attempts/last_error/requested_at —
 *           safe to call even if it's already queued.
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
    .select("track_id, last_synced_at")
    .eq("track_id", trackIdNum)
    .maybeSingle();

  if (!appError && appRow && appRow.last_synced_at != null) {
    console.log(`[reviews] track_id=${trackId} known, already synced, genuinely 0 reviews`);
    return { reviews: [], page, country };
  }

  console.log(`[reviews] track_id=${trackId} not cached (unknown or never synced) — falling back to live RSS`);
  const liveResult = await fetchReviewsLive(trackId, country, page);

  const { error: pendingError } = await supabase
    .from("pending_apps")
    .upsert({ track_id: trackIdNum }, { onConflict: "track_id" });
  if (pendingError) {
    console.error(`[reviews] Failed to queue track_id=${trackId} in pending_apps:`, pendingError.message);
  } else {
    console.log(`[reviews] track_id=${trackId} queued in pending_apps for full onboarding`);
  }

  return liveResult;
}
