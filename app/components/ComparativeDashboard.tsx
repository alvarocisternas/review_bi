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

export interface ComparativeAnalysisData {
  apps_analyzed: AppAnalyzed[];
  sample_warnings: string[];
  dimension_rankings: DimensionRanking[];
  category_wide_complaints: string[];
  differentiators: Differentiator[];
}

interface ComparativeDashboardProps {
  data: ComparativeAnalysisData;
}

export default function ComparativeDashboard({
  data,
}: ComparativeDashboardProps) {
  const {
    apps_analyzed,
    sample_warnings,
    dimension_rankings,
    category_wide_complaints,
    differentiators,
  } = data;

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
      {/* Header: apps analyzed */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Apps comparadas
        </h3>
        <ul className="space-y-2">
          {warningsByApp.map(({ app, warnings }) => (
            <li key={app.trackId} className="text-sm">
              <span className="text-zinc-900 dark:text-zinc-100">
                {app.appName}{" "}
                <span className="text-zinc-500">
                  ({app.reviewCount} reseñas)
                </span>
              </span>
              {warnings.map((warning, index) => (
                <p
                  key={index}
                  className="mt-0.5 text-xs text-yellow-700 dark:text-yellow-500"
                >
                  {warning}
                </p>
              ))}
            </li>
          ))}
        </ul>

        {generalWarnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {generalWarnings.map((warning, index) => (
              <p
                key={index}
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
    </div>
  );
}
