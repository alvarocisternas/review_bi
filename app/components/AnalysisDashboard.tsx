export interface SentimentData {
  label: "positivo" | "negativo" | "mixto";
  score: number;
  justification: string;
}

export interface HighlightedTheme {
  theme: string;
  description: string;
}

export interface SingleAnalysisData {
  sentiment: SentimentData;
  recurring_complaints: string[];
  requested_features: string[];
  highlighted_themes: HighlightedTheme[];
}

interface AnalysisDashboardProps {
  data: SingleAnalysisData;
}

function scoreBarColor(score: number): string {
  if (score < 40) return "bg-red-500";
  if (score <= 70) return "bg-yellow-500";
  return "bg-green-500";
}

export default function AnalysisDashboard({ data }: AnalysisDashboardProps) {
  const { sentiment, recurring_complaints, requested_features, highlighted_themes } =
    data;

  return (
    <div className="mt-3 space-y-6">
      {/* Sentiment */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-bold capitalize text-zinc-900 dark:text-zinc-100">
            {sentiment.label}
          </span>
          <span className="text-sm text-zinc-500">{sentiment.score}/100</span>
        </div>
        <div className="mt-2 h-3 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-3 rounded-full ${scoreBarColor(sentiment.score)}`}
            style={{ width: `${sentiment.score}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-zinc-500">{sentiment.justification}</p>
      </div>

      {/* Complaints / requested features */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Quejas recurrentes
          </h3>
          {recurring_complaints.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {recurring_complaints.map((complaint, index) => (
                <li key={index}>{complaint}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No se detectaron quejas recurrentes
            </p>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Features más pedidas
          </h3>
          {requested_features.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {requested_features.map((feature, index) => (
                <li key={index}>{feature}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No se detectaron features pedidas
            </p>
          )}
        </div>
      </div>

      {/* Highlighted themes */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Temas destacados
        </h3>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {highlighted_themes.map((item, index) => (
            <div key={index} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {item.theme}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
