interface RawLookupResult {
  trackId?: number;
  trackName?: string;
}

interface LookupResponse {
  resultCount: number;
  results: RawLookupResult[];
}

/**
 * Looks up app names for a set of trackIds via the iTunes Lookup API,
 * batched into a single request (comma-separated ids). A trackId with no
 * match on the Store is simply absent from the returned map — callers
 * should fall back to a placeholder name for missing entries.
 */
export async function lookupAppNames(
  trackIds: number[]
): Promise<Map<number, string>> {
  const idsParam = trackIds.join(",");
  const url = `https://itunes.apple.com/lookup?id=${idsParam}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`iTunes Lookup responded with status ${response.status}`);
  }

  const data: LookupResponse = await response.json();

  const map = new Map<number, string>();
  for (const result of data.results) {
    if (result.trackId != null && result.trackName != null) {
      map.set(result.trackId, result.trackName);
    }
  }
  return map;
}
