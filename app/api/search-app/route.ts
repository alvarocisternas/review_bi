import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface ITunesRawResult {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
  userRatingCount?: number;
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
  userRatingCount: number;
}

interface AppsRow {
  track_id: number;
  track_name: string;
  artist_name: string | null;
  artwork_url_100: string | null;
  primary_genre_name: string | null;
  user_rating_count: number | null;
}

const RESULT_LIMIT = 10;
// Below this many cache hits, the local table isn't confident enough to
// answer alone — fall back to a live search so the user still gets a
// useful result list instead of just 1-2 matches.
const MIN_CACHE_RESULTS = 3;

// Escapes ILIKE's own wildcard characters in the user's raw search term,
// so e.g. a literal "%" or "_" the user typed doesn't get interpreted as
// a pattern wildcard.
function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

function toSimplifiedApp(row: AppsRow): SimplifiedApp {
  return {
    trackId: row.track_id,
    trackName: row.track_name,
    artistName: row.artist_name ?? "",
    artworkUrl100: row.artwork_url_100 ?? "",
    primaryGenreName: row.primary_genre_name ?? "",
    userRatingCount: row.user_rating_count ?? 0,
  };
}

export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("term")?.trim();

  if (!term) {
    // Not reachable from the app's own UI today (the search box only ever
    // fires this fetch once the query is non-empty), but this is a public
    // route — a direct/malformed call must still get a Spanish, controlled
    // message like every other business-validation error in the project,
    // not an English one (audit finding, ALV-93).
    return NextResponse.json(
      { error: "El parámetro term es obligatorio" },
      { status: 400 }
    );
  }

  // --- Step 1: try our own cache first -------------------------------
  let cacheResults: SimplifiedApp[] = [];
  const { data: cacheRows, error: cacheError } = await supabase
    .from("apps")
    .select("track_id, track_name, artist_name, artwork_url_100, primary_genre_name, user_rating_count")
    .ilike("track_name", `%${escapeIlike(term)}%`)
    .order("user_rating_count", { ascending: false, nullsFirst: false })
    .limit(RESULT_LIMIT);

  if (cacheError) {
    // Not fatal — degrade to the live-only path below, same as if the
    // cache had simply found nothing.
    console.error("[search-app] Supabase cache query failed:", cacheError.message);
  } else {
    cacheResults = (cacheRows as AppsRow[]).map(toSimplifiedApp);
  }

  if (cacheResults.length >= MIN_CACHE_RESULTS) {
    console.log(`[search-app] term="${term}" served from cache (${cacheResults.length} results)`);
    return NextResponse.json({ results: cacheResults.slice(0, RESULT_LIMIT) });
  }

  // --- Step 2: fall back to a live iTunes search ----------------------
  console.log(`[search-app] term="${term}" cache had ${cacheResults.length} result(s) — falling back to live search`);

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
    // Same behavior as before this migration: a live-fetch network error
    // is always a 502, regardless of whether the cache had a partial (1-2
    // result) hit — kept exactly as the pre-existing error contract.
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes Search API" },
      { status: 502 }
    );
  }

  // Audit finding (ALV-93): a truthy resultCount with `results` missing or
  // not an array — an unexpected-but-possible iTunes shape — used to throw
  // straight through `data.results.length` uncaught, past this endpoint's
  // own try/catch (which only wraps the fetch + .json() parse above). The
  // frontend's fetchApi() happens to absorb that as a 500-with-empty-body
  // and still shows the generic popup, but the server-side bug is real —
  // guard the shape explicitly instead of relying on that safety net.
  const liveResults: SimplifiedApp[] =
    !data.resultCount || !Array.isArray(data.results) || data.results.length === 0
      ? []
      : data.results.map((item) => ({
          trackId: item.trackId,
          trackName: item.trackName,
          artistName: item.artistName,
          artworkUrl100: item.artworkUrl100,
          primaryGenreName: item.primaryGenreName,
          userRatingCount: item.userRatingCount ?? 0,
        }));

  // Register any live result we don't already have cached, so it's
  // available from the cache next time. Only inserted if genuinely new —
  // an existing row (whatever its source) is left completely untouched,
  // so a seeded app's source/rating/review history is never clobbered by
  // a live search hit.
  if (liveResults.length > 0) {
    const liveTrackIds = liveResults.map((r) => r.trackId);
    const { data: existingRows, error: existingError } = await supabase
      .from("apps")
      .select("track_id")
      .in("track_id", liveTrackIds);

    if (existingError) {
      console.error("[search-app] Failed to check existing apps before upsert:", existingError.message);
    } else {
      const existingIds = new Set((existingRows as { track_id: number }[]).map((r) => r.track_id));
      const newApps = liveResults.filter((r) => !existingIds.has(r.trackId));

      if (newApps.length > 0) {
        const { error: insertError } = await supabase.from("apps").upsert(
          newApps.map((app) => ({
            track_id: app.trackId,
            track_name: app.trackName,
            artist_name: app.artistName || null,
            artwork_url_100: app.artworkUrl100 || null,
            primary_genre_name: app.primaryGenreName || null,
            user_rating_count: app.userRatingCount,
            country: "cl",
            source: "organic",
          })),
          { onConflict: "track_id" }
        );
        if (insertError) {
          console.error("[search-app] Failed to register new organic apps:", insertError.message);
        } else {
          console.log(`[search-app] term="${term}" registered ${newApps.length} new organic app(s): ${newApps.map((a) => a.trackId).join(", ")}`);
        }
      }
    }
  }

  // --- Step 3: combine cache + live, deduplicated by trackId ---------
  const combined: SimplifiedApp[] = [...cacheResults];
  const seenIds = new Set(cacheResults.map((r) => r.trackId));
  for (const app of liveResults) {
    if (combined.length >= RESULT_LIMIT) break;
    if (seenIds.has(app.trackId)) continue;
    seenIds.add(app.trackId);
    combined.push(app);
  }

  return NextResponse.json({ results: combined });
}
