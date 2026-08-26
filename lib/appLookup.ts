export interface AppLookupInfo {
  trackId: number;
  trackName: string;
  averageUserRating?: number;
  userRatingCount?: number;
}

interface RawLookupResult {
  trackId?: number;
  trackName?: string;
  averageUserRating?: number;
  userRatingCount?: number;
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
 */
export async function lookupApps(
  trackIds: number[]
): Promise<Map<number, AppLookupInfo>> {
  const idsParam = trackIds.join(",");
  const url = `https://itunes.apple.com/lookup?id=${idsParam}`;

  const response = await fetch(url);

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
      });
    }
  }
  return map;
}

/** Thin wrapper over lookupApps for callers that only need trackName. */
export async function lookupAppNames(
  trackIds: number[]
): Promise<Map<number, string>> {
  const apps = await lookupApps(trackIds);
  const map = new Map<number, string>();
  for (const [trackId, info] of apps) {
    map.set(trackId, info.trackName);
  }
  return map;
}
