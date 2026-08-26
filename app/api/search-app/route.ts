import { NextRequest, NextResponse } from "next/server";

interface ITunesRawResult {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesRawResult[];
}

interface SimplifiedApp {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
}

export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("term")?.trim();

  if (!term) {
    return NextResponse.json({ error: "term is required" }, { status: 400 });
  }

  // country=CL restricts results to apps actually available on the Chilean
  // App Store — the Search API takes the country code uppercase (unlike
  // the RSS feeds' lowercase /cl/ path segment).
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term
  )}&entity=software&country=CL&limit=10`;

  let data: ITunesSearchResponse;
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`iTunes API responded with status ${response.status}`);
    }

    data = await response.json();
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes Search API" },
      { status: 502 }
    );
  }

  if (!data.resultCount || data.results.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results: SimplifiedApp[] = data.results.map((item) => ({
    trackId: item.trackId,
    trackName: item.trackName,
    artistName: item.artistName,
    artworkUrl100: item.artworkUrl100,
    primaryGenreName: item.primaryGenreName,
  }));

  return NextResponse.json({ results });
}
