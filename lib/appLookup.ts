// ALV-94: caps this outgoing call so a hung iTunes Lookup can't ride a
// caller's serverless function to its own platform-level limit. Every
// caller already wraps this in its own try/catch (or leaves it uncaught to
// propagate to one that does) — a timeout is just another way for the
// fetch below to fail, so this needs no new error-classification anywhere.
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface AppLookupInfo {
  trackId: number;
  trackName: string;
  averageUserRating?: number;
  userRatingCount?: number;
  // Added for the sync cron (app/api/cron/sync-apps): needed to upsert a
  // full apps row for organically-discovered apps, which don't have this
  // metadata cached yet. Optional so the existing trackName/rating-only
  // callers are unaffected.
  artistName?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
}

interface RawLookupResult {
  trackId?: number;
  trackName?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  artistName?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
}

interface LookupResponse {
  resultCount: number;
  results: RawLookupResult[];
}

/**
 * Looks up app info for a set of trackIds via the iTunes Lookup API,
 * batched into a single request (comma-separated ids). A trackId with no
 * match on the Store is simply absent from the returned map — callers
 * should fall back to a placeholder for missing entries.
 *
 * `country` is optional and defaults to omitted (Apple's global/US-ish
 * default), preserving every existing caller's current behavior exactly.
 * Pass it explicitly when the rating numbers need to reflect a specific
 * storefront — confirmed via a real side-by-side lookup (app/api/cron/
 * sync-apps' manual test) that this isn't cosmetic: an app with 0 US
 * ratings but real Chilean ones (Fintoc Me) came back as
 * averageUserRating=0/userRatingCount=0 without country=CL, vs its real
 * 4.625/16 with it.
 */
export async function lookupApps(
  trackIds: number[],
  country?: string
): Promise<Map<number, AppLookupInfo>> {
  const idsParam = trackIds.join(",");
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const url = `https://itunes.apple.com/lookup?id=${idsParam}${countryParam}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`iTunes Lookup responded with status ${response.status}`);
  }

  const data: LookupResponse = await response.json();

  const map = new Map<number, AppLookupInfo>();
  for (const result of data.results) {
    if (result.trackId != null && result.trackName != null) {
      map.set(result.trackId, {
        trackId: result.trackId,
        trackName: result.trackName,
        averageUserRating: result.averageUserRating,
        userRatingCount: result.userRatingCount,
        artistName: result.artistName,
        artworkUrl100: result.artworkUrl100,
        primaryGenreName: result.primaryGenreName,
      });
    }
  }
  return map;
}

/**
 * Thin wrapper over lookupApps for callers that only need trackName.
 *
 * `country` forwards straight to lookupApps — same reasoning applies here:
 * omitting it can silently return 0 results for an app that only exists in
 * a specific storefront. Found as a real bug during end-to-end testing:
 * app/api/analyze's comparative mode called this without country, so an
 * organic app not present in Apple's default/US lookup (but very much
 * real in the Chilean store, e.g. Buda.com) fell back to the placeholder
 * `App {trackId}` name instead of showing its real name in the dashboard.
 */
export async function lookupAppNames(
  trackIds: number[],
  country?: string
): Promise<Map<number, string>> {
  const apps = await lookupApps(trackIds, country);
  const map = new Map<number, string>();
  for (const [trackId, info] of apps) {
    map.set(trackId, info.trackName);
  }
  return map;
}
