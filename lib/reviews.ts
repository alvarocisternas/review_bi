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
  country: string = "us",
  page: number = 1
): Promise<ReviewsResult> {
  const countrySegment = country === "us" ? "" : `${country}/`;
  const url = `https://itunes.apple.com/${countrySegment}rss/customerreviews/id=${trackId}/page=${page}/sortby=mostrecent/json`;

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
