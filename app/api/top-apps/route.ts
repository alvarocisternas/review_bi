import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GENRE_IDS } from "@/lib/genreIds";

// Previously fetched the legacy top-free chart + a batched /lookup call
// live from Apple on every request. Now that scripts/seed-initial.ts has
// precomputed the real top 50 per category into the `apps` table (see
// that script and the sync cron for how it's kept fresh), this is a
// straight read from Supabase — no live Apple calls here at all anymore.
const RESULT_COUNT = 15;

interface AppsRow {
  track_id: number;
  track_name: string;
  artist_name: string | null;
  artwork_url_100: string | null;
  primary_genre_name: string | null;
  average_user_rating: number | null;
  user_rating_count: number | null;
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const genre = searchParams.get("genre");
  // Kept for response-shape compatibility and as the query param callers
  // already send; not used to filter the query below since the seed (and
  // the sync cron) only ever populate country='cl' — there's nothing else
  // in the cache to filter by yet.
  const country = searchParams.get("country")?.trim() || "cl";

  if (!genre || !(genre in GENRE_IDS)) {
    return NextResponse.json(
      { error: "Categoría no reconocida" },
      { status: 400 }
    );
  }

  // primary_genre_name is iTunes' own per-app genre string, confirmed
  // (during the seed run) to match every GENRE_IDS key exactly — the same
  // association the seed script itself used when writing these rows, so
  // this filter is consistent with how the data actually got here.
  // source IN (seed_category, seed_carousel): a carousel app can outrank
  // its way into a category's real top 15 (e.g. Spotify in Music), so
  // both sources need to be eligible, not just seed_category rows.
  const { data, error } = await supabase
    .from("apps")
    .select("track_id, track_name, artist_name, artwork_url_100, primary_genre_name, average_user_rating, user_rating_count")
    .eq("primary_genre_name", genre)
    .in("source", ["seed_category", "seed_carousel"])
    .order("average_user_rating", { ascending: false, nullsFirst: false })
    .limit(RESULT_COUNT);

  if (error) {
    console.error("[top-apps] Supabase query failed:", error.message);
    return NextResponse.json(
      { error: "No se pudo obtener el top de apps para esta categoría" },
      { status: 502 }
    );
  }

  const rows = (data ?? []) as AppsRow[];

  // No live fallback on <15 results (e.g. News currently has 39 candidates
  // total, comfortably over 15, but if some category ever genuinely has
  // fewer than 15 qualifying apps cached): returning fewer than 15 is the
  // correct behavior here, not an error. Falling back to a live Apple
  // call would reintroduce the exact per-request Apple dependency this
  // migration exists to remove — the seed + the daily sync cron are what
  // keep this table populated, not this endpoint.
  const results: RankedApp[] = rows
    .filter((row) => row.average_user_rating != null)
    .map((row) => ({
      trackId: row.track_id,
      trackName: row.track_name,
      artistName: row.artist_name ?? "",
      artworkUrl100: row.artwork_url_100 ?? "",
      primaryGenreName: row.primary_genre_name ?? genre,
      averageUserRating: row.average_user_rating!,
      userRatingCount: row.user_rating_count ?? 0,
    }));

  return NextResponse.json({ genre, country, results });
}
