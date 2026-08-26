import { NextRequest, NextResponse } from "next/server";
import { GENRE_IDS } from "@/lib/genreIds";
import { lookupApps } from "@/lib/appLookup";

// How many top-free candidates to pull from the chart before filtering by
// rating reliability — a wide pool so enough survive the threshold below.
const POOL_SIZE = 100;

// Below this many ratings, averageUserRating is too noisy to trust (a 5.0
// from 3 reviews would otherwise outrank a 4.6 from 50,000).
const MIN_RATING_COUNT = 50;

const RESULT_COUNT = 15;

interface RawChartImage {
  label?: string;
  attributes?: { height?: string };
}

interface RawChartEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: { label?: string };
  "im:artist"?: { label?: string };
  "im:image"?: RawChartImage[];
}

interface ChartFeedResponse {
  feed?: {
    entry?: RawChartEntry[];
  };
}

interface ChartCandidate {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
}

interface RankedApp {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
  averageUserRating: number;
  userRatingCount: number;
}

function parseChartEntry(entry: RawChartEntry): ChartCandidate | null {
  const trackIdLabel = entry.id?.attributes?.["im:id"];
  const trackName = entry["im:name"]?.label;
  const artistName = entry["im:artist"]?.label;
  const images = entry["im:image"] ?? [];

  if (!trackIdLabel || !trackName || !artistName || images.length === 0) {
    return null;
  }

  const trackId = Number(trackIdLabel);
  if (!Number.isFinite(trackId)) {
    return null;
  }

  // Pick the highest-resolution artwork the feed offers.
  const bestImage = images.reduce((best, image) => {
    const height = Number(image.attributes?.height ?? 0);
    const bestHeight = Number(best.attributes?.height ?? 0);
    return height > bestHeight ? image : best;
  }, images[0]);

  if (!bestImage.label) {
    return null;
  }

  return { trackId, trackName, artistName, artworkUrl: bestImage.label };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const genre = searchParams.get("genre");
  const country = searchParams.get("country")?.trim() || "us";

  if (!genre || !(genre in GENRE_IDS)) {
    return NextResponse.json(
      { error: "Categoría no reconocida" },
      { status: 400 }
    );
  }

  const genreId = GENRE_IDS[genre];

  let candidates: ChartCandidate[];
  try {
    const chartUrl = `https://itunes.apple.com/${country}/rss/topfreeapplications/limit=${POOL_SIZE}/genre=${genreId}/json`;
    const chartResponse = await fetch(chartUrl);

    if (!chartResponse.ok) {
      throw new Error(`chart feed responded with status ${chartResponse.status}`);
    }

    const chartData: ChartFeedResponse = await chartResponse.json();
    const rawEntry = chartData.feed?.entry;
    // Same Apple quirk as the reviews feed: a single-result feed collapses
    // to an object instead of an array.
    const entries: RawChartEntry[] = Array.isArray(rawEntry)
      ? rawEntry
      : rawEntry
      ? [rawEntry]
      : [];

    candidates = entries
      .map(parseChartEntry)
      .filter((entry): entry is ChartCandidate => entry !== null);
  } catch {
    return NextResponse.json(
      { error: "No se pudo obtener el top de apps para esta categoría" },
      { status: 502 }
    );
  }

  if (candidates.length === 0) {
    return NextResponse.json({ genre, country, results: [] });
  }

  let ratings: Map<number, { averageUserRating?: number; userRatingCount?: number }>;
  try {
    ratings = await lookupApps(candidates.map((c) => c.trackId));
  } catch {
    return NextResponse.json(
      { error: "No se pudo obtener el top de apps para esta categoría" },
      { status: 502 }
    );
  }

  const ranked: RankedApp[] = [];
  for (const candidate of candidates) {
    const info = ratings.get(candidate.trackId);

    if (
      !info ||
      info.averageUserRating == null ||
      info.userRatingCount == null ||
      info.userRatingCount < MIN_RATING_COUNT
    ) {
      continue;
    }

    ranked.push({
      trackId: candidate.trackId,
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      artworkUrl100: candidate.artworkUrl,
      primaryGenreName: genre,
      averageUserRating: info.averageUserRating,
      userRatingCount: info.userRatingCount,
    });
  }

  ranked.sort((a, b) => b.averageUserRating - a.averageUserRating);

  return NextResponse.json({
    genre,
    country,
    results: ranked.slice(0, RESULT_COUNT),
  });
}
