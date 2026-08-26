import { NextRequest, NextResponse } from "next/server";

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

interface Review {
  author: string;
  title: string;
  content: string;
  rating: number;
  date: string;
  version: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const searchParams = request.nextUrl.searchParams;

  const country = searchParams.get("country")?.trim() || "us";
  const pageParam = searchParams.get("page")?.trim();
  const page = pageParam && !isNaN(Number(pageParam)) ? Number(pageParam) : 1;

  const countrySegment = country === "us" ? "" : `${country}/`;
  const url = `https://itunes.apple.com/${countrySegment}rss/customerreviews/id=${trackId}/page=${page}/sortby=mostrecent/json`;

  let data: RssResponse;
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`iTunes RSS responded with status ${response.status}`);
    }

    data = await response.json();
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes RSS" },
      { status: 502 }
    );
  }

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

  return NextResponse.json({ reviews, page, country });
}
