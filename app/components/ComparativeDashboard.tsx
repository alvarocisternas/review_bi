export interface AppAnalyzed {
  trackId: number;
  appName: string;
  reviewCount: number;
}

export interface DimensionRanking {
  dimension: string;
  ranking: { appName: string; note: string }[];
}

export interface Differentiator {
  appName: string;
  differentiator: string;
}

export interface Conclusion {
  best_app: string;
  reasoning: string;
}

export interface ComparativeAnalysisData {
  apps_analyzed: AppAnalyzed[];
  sample_warnings: string[];
  dimension_rankings: DimensionRanking[];
  category_wide_complaints: string[];
  differentiators: Differentiator[];
  conclusion: Conclusion;
}

interface ComparativeDashboardProps {
  data: ComparativeAnalysisData;
  /** trackId -> artworkUrl100, sourced from the selected-apps state (the
   * backend's apps_analyzed doesn't carry artwork). Missing entries fall
   * back to a placeholder square instead of breaking the layout. */
  artworkByTrackId: Record<number, string>;
}

export default function ComparativeDashboard({
  data,
  artworkByTrackId,
}: ComparativeDashboardProps) {
  const {
    apps_analyzed,
    sample_warnings,
    dimension_rankings,
    category_wide_complaints,
    differentiators,
    conclusion,
  } = data;

  const bestApp = apps_analyzed.find(
    (app) => app.appName === conclusion.best_app
  );
  const bestAppArtwork = bestApp ? artworkByTrackId[bestApp.trackId] : undefined;

  // Associate each warning with every app it mentions; anything left over
  // doesn't match a known app name and falls back to a general note.
  const matchedWarnings = new Set<string>();
  const warningsByApp = apps_analyzed.map((app) => {
    const warnings = sample_warnings.filter((warning) =>
      warning.includes(app.appName)
    );
    warnings.forEach((warning) => matchedWarnings.add(warning));
    return { app, warnings };
  });
  const generalWarnings = sample_warnings.filter(
    (warning) => !matchedWarnings.has(warning)
  );

  return (
    <div className="mt-3 space-y-6">
      {/* Header: apps analyzed — iOS home-screen style, icon with the name
          centered below it. reviewCount no longer shows here; sample
          warnings surface as a small badge on the icon plus the full text
          underneath, so that information isn't lost. */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Apps comparadas
        </h3>
        <div className="flex flex-wrap justify-center gap-4">
          {warningsByApp.map(({ app, warnings }) => {
            const artworkUrl = artworkByTrackId[app.trackId];
            const hasWarning = warnings.length > 0;

            return (
              <div
                key={app.trackId}
                className="flex w-16 flex-shrink-0 flex-col items-center"
              >
                <div className="relative">
                  {artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artworkUrl}
                      alt={app.appName}
                      className="h-16 w-16 rounded-2xl"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
                  )}
                  {hasWarning && (
                    <span
                      title={warnings.join(" ")}
                      className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-yellow-400 ring-2 ring-white dark:ring-zinc-950"
                    />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 w-full text-center text-xs text-zinc-700 dark:text-zinc-300">
                  {app.appName}
                </p>
              </div>
            );
          })}
        </div>

        {(warningsByApp.some(({ warnings }) => warnings.length > 0) ||
          generalWarnings.length > 0) && (
          <div className="mt-3 space-y-1">
            {warningsByApp.flatMap(({ app, warnings }) =>
              warnings.map((warning, index) => (
                <p
                  key={`${app.trackId}-${index}`}
                  className="text-xs text-yellow-700 dark:text-yellow-500"
                >
                  {warning}
                </p>
              ))
            )}
            {generalWarnings.map((warning, index) => (
              <p
                key={`general-${index}`}
                className="text-xs text-yellow-700 dark:text-yellow-500"
              >
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Dimension rankings table */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Comparación por dimensión
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800">
                <th className="border border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-900 dark:border-zinc-700 dark:text-zinc-100">
                  Dimensión
                </th>
                {apps_analyzed.map((app) => (
                  <th
                    key={app.trackId}
                    className="border border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                  >
                    {app.appName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimension_rankings.map((dimension, index) => (
                <tr key={index}>
                  <td className="border border-zinc-200 px-3 py-2 align-top font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-100">
                    {dimension.dimension}
                  </td>
                  {apps_analyzed.map((app) => {
                    const rankIndex = dimension.ranking.findIndex(
                      (entry) => entry.appName === app.appName
                    );

                    if (rankIndex === -1) {
                      return (
                        <td
                          key={app.trackId}
                          className="border border-zinc-200 px-3 py-2 align-top text-zinc-400 dark:border-zinc-700"
                        >
                          —
                        </td>
                      );
                    }

                    return (
                      <td
                        key={app.trackId}
                        className="border border-zinc-200 px-3 py-2 align-top dark:border-zinc-700"
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {rankIndex + 1}°
                        </span>
                        <p className="mt-1 text-xs text-zinc-500">
                          {dimension.ranking[rankIndex].note}
                        </p>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category-wide complaints */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Quejas comunes a la categoría
        </h3>
        {category_wide_complaints.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {category_wide_complaints.map((complaint, index) => (
              <li key={index}>{complaint}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            No se detectaron quejas comunes entre estas apps
          </p>
        )}
      </div>

      {/* Differentiators */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Qué distingue a cada app
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {differentiators.map((item, index) => (
            <div
              key={index}
              className="w-56 flex-shrink-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="font-bold text-zinc-900 dark:text-zinc-100">
                {item.appName}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {item.differentiator}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Conclusion — the closing verdict, styled to stand apart */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Conclusión
        </h3>
        <div className="flex items-center gap-3">
          {bestAppArtwork && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bestAppArtwork}
              alt={conclusion.best_app}
              className="h-10 w-10 flex-shrink-0 rounded-xl"
            />
          )}
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            {conclusion.best_app}
          </p>
        </div>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {conclusion.reasoning}
        </p>
      </div>
    </div>
  );
}
