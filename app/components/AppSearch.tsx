"use client";

import { useEffect, useRef, useState } from "react";
import AnalysisDashboard, {
  SingleAnalysisData,
} from "./AnalysisDashboard";
import ComparativeDashboard, {
  ComparativeAnalysisData,
} from "./ComparativeDashboard";
import { GENRE_IDS } from "@/lib/genreIds";

export interface App {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
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

export default function AppSearch() {
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH;
  const isMaxReached = selectedApps.length >= MAX_SELECTED_APPS;

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
      try {
        const response = await fetch(
          `/api/search-app?term=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error(`search-app responded with status ${response.status}`);
        }

        const data: { results: App[] } = await response.json();
        setResults(data.results);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError("Hubo un problema buscando apps, intenta de nuevo");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [term]);

  function handleAdd(app: App) {
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
    setSelectedApps((prev) => prev.filter((app) => app.trackId !== trackId));
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

    try {
      const response = await fetch(
        `/api/top-apps?genre=${encodeURIComponent(category)}`
      );
      const data = await response.json();

      // A different category was clicked (or this one was toggled off)
      // before this request resolved — discard the now-stale result.
      if (latestCategoryRequestRef.current !== category) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ?? `top-apps responded with status ${response.status}`
        );
      }

      setCategoryResults(data.results);
    } catch {
      if (latestCategoryRequestRef.current !== category) {
        return;
      }
      setCategoryError(
        "No se pudo cargar el top de esta categoría, intenta de nuevo"
      );
    } finally {
      if (latestCategoryRequestRef.current === category) {
        setCategoryLoading(false);
      }
    }
  }

  async function handleAnalyze() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackIds: selectedApps.map((app) => app.trackId),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ?? `analyze responded with status ${response.status}`
        );
      }

      setAnalysisResult(data);
    } catch (err) {
      setAnalysisError(
        err instanceof Error
          ? err.message
          : "Hubo un problema generando el análisis, intenta de nuevo"
      );
    } finally {
      setAnalysisLoading(false);
    }
  }

  // Explicit full reset for "start a new comparison from scratch". Editing
  // the current selection (add/remove/re-analyze) never triggers this —
  // only this button does, per the UX fix: search/category browsing on
  // their own must NOT wipe an existing selection or result.
  function handleNewComparison() {
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
      <input
        ref={searchInputRef}
        type="text"
        value={term}
        onChange={(e) => handleTermChange(e.target.value)}
        placeholder="Buscar apps (ej. Spotify)"
        className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />

      <button
        type="button"
        onClick={() => setShowCategoryChips((prev) => !prev)}
        className="mt-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
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
              {category}
            </button>
          ))}
        </div>
      )}

      {activeCategory && (
        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {categoryLoading && (
            <p className="text-sm text-zinc-500">
              Cargando top de {activeCategory}...
            </p>
          )}

          {categoryError && (
            <p className="text-sm text-red-600">{categoryError}</p>
          )}

          {!categoryLoading && !categoryError && categoryResults && (
            <>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Top 15 en {activeCategory} por calificación
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
                const isAddDisabled = isSelected || isMaxReached;

                return (
                  <li key={app.trackId} className="flex items-center gap-3 py-3">
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
                          {app.primaryGenreName}
                        </span>
                      </div>
                      <p className="truncate text-xs text-zinc-500">
                        {app.artistName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAdd(app)}
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

      {selectedApps.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Apps seleccionadas
          </h3>

          {showMixedCategoryWarning && (
            <p className="mb-3 rounded-md bg-yellow-100 px-3 py-2 text-xs text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200">
              Estás comparando apps de categorías distintas:{" "}
              {uniqueGenres.join(", ")}
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
                <button
                  type="button"
                  onClick={handleNewComparison}
                  className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
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
    </div>
  );
}
