"use client";

import { useEffect, useRef, useState } from "react";
import AnalysisDashboard, {
  SingleAnalysisData,
} from "./AnalysisDashboard";
import ComparativeDashboard, {
  ComparativeAnalysisData,
} from "./ComparativeDashboard";
import ApiErrorModal from "./ApiErrorModal";
import { GENRE_IDS, GENRE_LABELS_ES } from "@/lib/genreIds";

export interface App {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
  userRatingCount: number;
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

type AnalyzeResponse =
  | { mode: "single"; data: SingleAnalysisData }
  | { mode: "comparative"; data: ComparativeAnalysisData };

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;
const MAX_SELECTED_APPS = 5;
const CATEGORIES = Object.keys(GENRE_IDS);

// userRatingCount counts star ratings, NOT written reviews — they're
// different metrics. We only block adding an app when it's at (or near)
// zero ratings, since that's the one case where it's a near-certainty
// there's nothing written to analyze either (e.g. a just-launched app).
// A deliberately conservative threshold: apps with a handful of ratings
// might still have real reviews, so we don't want to penalize those.
const MIN_RATINGS_TO_COMPARE = 1;

const API_ERROR_MESSAGE =
  "Existen problemas en la API que no podemos controlar. Inténtelo más tarde";

type FetchApiResult<T> =
  | { kind: "success"; data: T }
  | { kind: "business"; message: string }
  | { kind: "aborted" };

export default function AppSearch() {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 'browse' shows the full search/category UI; 'focused' (entered by
  // clicking "Analizar esta app"/"Comparar") narrows the screen down to
  // just the current selection and its analysis result, so the user isn't
  // distracted by the search/category UI while reviewing it. Editing the
  // selection (removing an app, re-analyzing) still works in 'focused' —
  // only adding a *new* app requires going back to 'browse' first, since
  // that requires the hidden search/category UI.
  const [mode, setMode] = useState<"browse" | "focused">("browse");

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<App[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedApps, setSelectedApps] = useState<App[]>([]);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(
    null
  );

  const [showCategoryChips, setShowCategoryChips] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Tracks which category's fetch is the one that should be allowed to
  // write its result — set synchronously on every click/toggle, so a
  // response for a category that's no longer active (superseded by another
  // click, or turned off) can detect that and bail out instead of applying.
  const latestCategoryRequestRef = useRef<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryResults, setCategoryResults] = useState<RankedApp[] | null>(
    null
  );

  // Global popup for infrastructure-level API failures — 5xx, network
  // errors, or responses we can't parse/use. Business validation errors
  // (400/422 with a known { error } message) never touch this; they keep
  // showing inline via the per-section error states above.
  const [apiError, setApiError] = useState<string | null>(null);

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH;
  const isMaxReached = selectedApps.length >= MAX_SELECTED_APPS;

  // Centralized fetch wrapper used by every API call in this component, so
  // the business-vs-infrastructure distinction is handled in exactly one
  // place instead of being duplicated per handler:
  //   - Network exception (fetch throws, not an abort) -> popup.
  //   - Response body isn't valid JSON -> popup (nothing renderable).
  //   - response.status >= 500 -> popup (an infra fault, regardless of body).
  //   - response.ok === false with a well-formed { error: string } body
  //     (our 400/422 business validation responses) -> returned to the
  //     caller as "business", to render inline like today.
  //   - Any other non-ok response (malformed 4xx body) -> popup, since
  //     there's no usable message to show inline either.
  //   - A caller-driven AbortController (e.g. the search debounce
  //     cancelling a stale request on retype) -> "aborted", handled
  //     silently by the caller, never the popup.
  async function fetchApi<T>(
    input: string,
    init?: RequestInit
  ): Promise<FetchApiResult<T> | null> {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { kind: "aborted" };
      }
      setApiError(API_ERROR_MESSAGE);
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      setApiError(API_ERROR_MESSAGE);
      return null;
    }

    if (!response.ok) {
      if (response.status < 500 && isKnownErrorBody(body)) {
        return { kind: "business", message: body.error };
      }
      setApiError(API_ERROR_MESSAGE);
      return null;
    }

    return { kind: "success", data: body as T };
  }

  function handleTermChange(value: string) {
    setTerm(value);

    if (value.trim().length < MIN_QUERY_LENGTH) {
      // Below the minimum length — nothing to show, don't wait on a timer.
      setResults([]);
      setError(null);
      setLoading(false);
    } else {
      // Give instant feedback; the actual request is debounced below.
      setError(null);
      setLoading(true);
    }
  }

  // Debounced fetch: schedules the request 400ms after the user stops
  // typing. State updates happen inside the timeout/fetch callbacks, not
  // synchronously in the effect body, so a change in `term` only cancels
  // a pending timer/request — it never triggers an update on its own.
  useEffect(() => {
    const trimmed = term.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      return;
    }

    const controller = new AbortController();

    const timeoutId = setTimeout(async () => {
      setLoading(true);
      setError(null);

      const result = await fetchApi<{ results: App[] }>(
        `/api/search-app?term=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      );

      if (!result || result.kind === "aborted") {
        // Either the popup already fired (infra failure), or this request
        // was cancelled because the user kept typing — nothing to show.
        setLoading(false);
        return;
      }

      if (result.kind === "business") {
        setError(result.message);
        setResults([]);
      } else {
        setResults(result.data.results);
      }
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [term]);

  function handleAdd(app: App) {
    if (app.userRatingCount < MIN_RATINGS_TO_COMPARE) {
      // Defense in depth — the UI already hides/disables "Agregar" for
      // these, but never silently add an app with no ratings/reviews.
      return;
    }

    setSelectedApps((prev) => {
      if (prev.some((selected) => selected.trackId === app.trackId)) {
        return prev;
      }
      if (prev.length >= MAX_SELECTED_APPS) {
        return prev;
      }
      return [...prev, app];
    });
  }

  function handleRemove(trackId: number) {
    const next = selectedApps.filter((app) => app.trackId !== trackId);
    setSelectedApps(next);

    // Removing the last selected app while in 'focused' mode is a real
    // dead end otherwise: the "Apps seleccionadas" block (which holds the
    // only "Nueva comparación" button) is gated on selectedApps.length > 0,
    // and the search/category UI stays hidden until 'browse' — so the
    // screen would render nothing at all, with analysisResult left
    // orphaned in state. The stale result belongs to an app that was just
    // actively removed, so it no longer makes sense to show it — treat
    // this the same as clicking "Nueva comparación" (minus resetting the
    // unrelated search/category state, which the user never touched here)
    // so there's always something to do next. Going from N apps down to 1+
    // is unaffected — this only fires on the removal that empties the
    // selection.
    if (next.length === 0 && mode === "focused") {
      setMode("browse");
      setAnalysisResult(null);
      setAnalysisError(null);
      setAnalysisLoading(false);
    }
  }

  async function handleCategoryClick(category: string) {
    if (activeCategory === category) {
      // Toggle off: close the ranking, but leave selectedApps untouched.
      latestCategoryRequestRef.current = null;
      setActiveCategory(null);
      setCategoryLoading(false);
      setCategoryError(null);
      setCategoryResults(null);
      return;
    }

    latestCategoryRequestRef.current = category;
    setActiveCategory(category);
    setCategoryLoading(true);
    setCategoryError(null);
    setCategoryResults(null);

    const result = await fetchApi<{ results: RankedApp[] }>(
      `/api/top-apps?genre=${encodeURIComponent(category)}`
    );

    // A different category was clicked (or this one was toggled off)
    // before this request resolved — discard the now-stale result.
    if (latestCategoryRequestRef.current !== category) {
      return;
    }

    if (result?.kind === "success") {
      setCategoryResults(result.data.results);
    } else if (result?.kind === "business") {
      setCategoryError(result.message);
    }
    // Otherwise: the popup already fired (infra failure) — nothing more to
    // show in this section.

    setCategoryLoading(false);
  }

  async function handleAnalyze() {
    setMode("focused");
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    const result = await fetchApi<AnalyzeResponse>("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackIds: selectedApps.map((app) => app.trackId),
      }),
    });

    if (result?.kind === "success") {
      setAnalysisResult(result.data);
    } else if (result?.kind === "business") {
      setAnalysisError(result.message);
    }
    // Otherwise: the popup already fired (infra failure).

    setAnalysisLoading(false);
  }

  // Explicit full reset for "start a new comparison from scratch". Editing
  // the current selection (add/remove/re-analyze) never triggers this —
  // only this button does, per the UX fix: search/category browsing on
  // their own must NOT wipe an existing selection or result.
  function handleNewComparison() {
    setMode("browse");
    setSelectedApps([]);

    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisLoading(false);

    setTerm("");
    setResults([]);
    setError(null);
    setLoading(false);

    setShowCategoryChips(false);
    latestCategoryRequestRef.current = null;
    setActiveCategory(null);
    setCategoryLoading(false);
    setCategoryError(null);
    setCategoryResults(null);

    searchInputRef.current?.focus();
  }

  const showEmptyState = hasQuery && !loading && !error && results.length === 0;

  const uniqueGenres = Array.from(
    new Set(selectedApps.map((app) => app.primaryGenreName))
  );
  const showMixedCategoryWarning =
    selectedApps.length >= 2 && uniqueGenres.length > 1;

  const artworkByTrackId = Object.fromEntries(
    selectedApps.map((app) => [app.trackId, app.artworkUrl100])
  );

  return (
    <div className="mx-auto w-full max-w-xl">
      {apiError && (
        <ApiErrorModal message={apiError} onClose={() => setApiError(null)} />
      )}

      {mode === "browse" && (
        <input
          ref={searchInputRef}
          type="text"
          value={term}
          onChange={(e) => handleTermChange(e.target.value)}
          placeholder="Buscar apps (ej. Spotify)"
          className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      )}

      {selectedApps.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Apps seleccionadas
          </h3>

          {showMixedCategoryWarning && (
            <p className="mb-3 rounded-md bg-yellow-100 px-3 py-2 text-xs text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200">
              Estás comparando apps de categorías distintas:{" "}
              {uniqueGenres
                .map((genre) => GENRE_LABELS_ES[genre] ?? genre)
                .join(", ")}
            </p>
          )}

          {/* iOS home-screen style: icon with the name centered below it,
              and a small "x" badge to remove — this is now the ONLY
              rendering of the live selection (the old icon+name+badge+x
              row list was removed to stop duplicating this same
              information). */}
          <div className="flex flex-wrap justify-center gap-4">
            {selectedApps.map((app) => (
              <div
                key={app.trackId}
                className="flex w-16 flex-shrink-0 flex-col items-center"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={app.artworkUrl100}
                    alt={app.trackName}
                    className="h-16 w-16 rounded-2xl"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(app.trackId)}
                    aria-label={`Quitar ${app.trackName}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-zinc-800 text-xs font-bold leading-none text-white ring-2 ring-white hover:bg-zinc-950 dark:ring-zinc-950"
                  >
                    ×
                  </button>
                </div>
                <p className="mt-1 line-clamp-2 w-full text-center text-xs text-zinc-700 dark:text-zinc-300">
                  {app.trackName}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            {selectedApps.length === 1 && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analysisLoading}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700"
              >
                Analizar esta app
              </button>
            )}

            {selectedApps.length >= 2 && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analysisLoading}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700"
              >
                Comparar
              </button>
            )}

            {analysisLoading && (
              <p className="mt-2 text-sm text-zinc-500">
                Analizando... esto puede tardar unos segundos
              </p>
            )}

            {analysisError && (
              <p className="mt-2 text-sm text-red-600">{analysisError}</p>
            )}

            {analysisResult && (
              <div className="mb-3 flex justify-end">
                {/* Same container treatment as "Analizar esta
                    app"/"Comparar" (padding, rounded-md, text-sm
                    font-medium) so it reads as an equally clickable
                    action — bordered/outlined instead of solid-filled to
                    mark it as the secondary action next to that primary
                    button. */}
                <button
                  type="button"
                  onClick={handleNewComparison}
                  className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Nueva comparación
                </button>
              </div>
            )}

            {analysisResult && analysisResult.mode === "single" && (
              <AnalysisDashboard data={analysisResult.data} />
            )}

            {analysisResult && analysisResult.mode === "comparative" && (
              <ComparativeDashboard
                data={analysisResult.data}
                artworkByTrackId={artworkByTrackId}
              />
            )}
          </div>
        </div>
      )}

      {mode === "browse" && (
        <>
          <button
            type="button"
            onClick={() => setShowCategoryChips((prev) => !prev)}
            className="mt-4 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Explorar por categoría
          </button>

          {showCategoryChips && (
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => handleCategoryClick(category)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    activeCategory === category
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  {GENRE_LABELS_ES[category] ?? category}
                </button>
              ))}
            </div>
          )}

          {/* Search-by-name results always render above the active
              category's ranking when both are on screen — this block comes
              first in the JSX, the category ranking block follows it. */}
          <div className="mt-4">
            {loading && <p className="text-sm text-zinc-500">Buscando...</p>}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {showEmptyState && (
              <p className="text-sm text-zinc-500">
                No se encontraron apps con ese nombre
              </p>
            )}

            {!loading && !error && results.length > 0 && (
              <>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {results.map((app) => {
                    const isSelected = selectedApps.some(
                      (selected) => selected.trackId === app.trackId
                    );
                    const hasNoRatings =
                      app.userRatingCount < MIN_RATINGS_TO_COMPARE;
                    const isAddDisabled =
                      isSelected || isMaxReached || hasNoRatings;

                    return (
                      <li
                        key={app.trackId}
                        className="flex items-center gap-3 py-3"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={app.artworkUrl100}
                          alt={app.trackName}
                          className="h-10 w-10 flex-shrink-0 rounded-lg"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {app.trackName}
                            </p>
                            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                              {GENRE_LABELS_ES[app.primaryGenreName] ?? app.primaryGenreName}
                            </span>
                          </div>
                          <p className="truncate text-xs text-zinc-500">
                            {app.artistName}
                          </p>
                        </div>
                        {hasNoRatings ? (
                          <span className="shrink-0 text-right text-xs text-zinc-400 dark:text-zinc-500">
                            No tiene reseñas para ser comparada
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAdd(app)}
                            disabled={isAddDisabled}
                            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                          >
                            {isSelected ? "Agregada" : "Agregar"}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {isMaxReached && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Máximo 5 apps por análisis
                  </p>
                )}
              </>
            )}
          </div>

          {activeCategory && (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {categoryLoading && (
                <p className="text-sm text-zinc-500">
                  Cargando top de{" "}
                  {GENRE_LABELS_ES[activeCategory] ?? activeCategory}...
                </p>
              )}

              {categoryError && (
                <p className="text-sm text-red-600">{categoryError}</p>
              )}

              {!categoryLoading && !categoryError && categoryResults && (
                <>
                  <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Top 15 en {GENRE_LABELS_ES[activeCategory] ?? activeCategory}{" "}
                    por calificación
                  </h3>
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {categoryResults.map((app) => {
                      const isSelected = selectedApps.some(
                        (selected) => selected.trackId === app.trackId
                      );
                      const isAddDisabled = isSelected || isMaxReached;

                      return (
                        <li
                          key={app.trackId}
                          className="flex items-center gap-3 py-3"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={app.artworkUrl100}
                            alt={app.trackName}
                            className="h-10 w-10 flex-shrink-0 rounded-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {app.trackName}
                            </p>
                            <p className="truncate text-xs text-zinc-500">
                              {app.artistName}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm text-zinc-600 dark:text-zinc-400">
                            <span className="text-yellow-500">★</span>{" "}
                            {app.averageUserRating.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleAdd({
                                trackId: app.trackId,
                                trackName: app.trackName,
                                artistName: app.artistName,
                                artworkUrl100: app.artworkUrl100,
                                primaryGenreName: app.primaryGenreName,
                                userRatingCount: app.userRatingCount,
                              })
                            }
                            disabled={isAddDisabled}
                            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                          >
                            {isSelected ? "Agregada" : "Agregar"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {isMaxReached && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Máximo 5 apps por análisis
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function isKnownErrorBody(body: unknown): body is { error: string } {
  return (
    !!body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  );
}
