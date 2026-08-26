"use client";

import { useEffect, useState } from "react";

export interface App {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  primaryGenreName: string;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

export default function AppSearch() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<App[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedApps, setSelectedApps] = useState<App[]>([]);

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH;

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
      return [...prev, app];
    });
  }

  const showEmptyState = hasQuery && !loading && !error && results.length === 0;

  return (
    <div className="mx-auto w-full max-w-xl">
      <input
        type="text"
        value={term}
        onChange={(e) => handleTermChange(e.target.value)}
        placeholder="Buscar apps (ej. Spotify)"
        className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />

      <div className="mt-4">
        {loading && <p className="text-sm text-zinc-500">Buscando...</p>}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {showEmptyState && (
          <p className="text-sm text-zinc-500">
            No se encontraron apps con ese nombre
          </p>
        )}

        {!loading && !error && results.length > 0 && (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map((app) => {
              const isSelected = selectedApps.some(
                (selected) => selected.trackId === app.trackId
              );

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
                    disabled={isSelected}
                    className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                  >
                    {isSelected ? "Agregada" : "Agregar"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selectedApps.length > 0 && (
          <p className="mt-3 text-sm text-zinc-500">
            {selectedApps.length} apps agregadas
          </p>
        )}
      </div>
    </div>
  );
}
