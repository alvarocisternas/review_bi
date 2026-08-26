interface RawEntry {
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

/**
 * Fetches and parses reviews from the iTunes customer reviews RSS feed.
 * Throws if the request to iTunes fails — callers decide how to surface that.
 */
export async function fetchReviews(
  trackId: string,
  country: string = "cl",
  page: number = 1
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
      return ratingLabel != null && authorName != null;
    })
    .map((entry) => ({
      author: entry.author!.name!.label!,
      title: entry.title?.label ?? "",
      content: entry.content?.label ?? "",
      rating: Number(entry["im:rating"]!.label),
      date: entry.updated?.label ?? "",
      version: entry["im:version"]?.label ?? "",
    }));

  return { reviews, page, country };
}
