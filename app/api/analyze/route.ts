import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchReviews, ReviewsResult } from "@/lib/reviews";
import { lookupAppNames } from "@/lib/appLookup";

const client = new Anthropic();

const MAX_REVIEWS_SINGLE = 50;
const MAX_REVIEWS_PER_APP_COMPARATIVE = 30;
// Single-app mode only: below this, there's nothing to analyze at all.
const MIN_REVIEWS_REQUIRED = 5;
const MAX_APPS = 5;
const LOW_VOLUME_RATIO_THRESHOLD = 0.3;
// Comparative mode only: an app needs at least this many reviews to be
// included in the comparison — apps with 0 reviews (nothing to say about
// them) are excluded from the set sent to Claude, not from the whole
// request.
const MIN_REVIEWS_COMPARATIVE = 1;
// Comparative mode only: included apps below this get flagged in
// sample_warnings as low-confidence, but still enter the analysis.
const LOW_REVIEW_THRESHOLD = 10;

const registrarAnalisisTool: Anthropic.Tool = {
  name: "registrar_analisis",
  description:
    "Registra el análisis estructurado de un conjunto de reseñas de una app.",
  input_schema: {
    type: "object",
    properties: {
      sentiment: {
        type: "object",
        properties: {
          label: { type: "string", enum: ["positivo", "negativo", "mixto"] },
          score: { type: "number", minimum: 0, maximum: 100 },
          justification: { type: "string" },
        },
        required: ["label", "score", "justification"],
      },
      recurring_complaints: { type: "array", items: { type: "string" } },
      requested_features: { type: "array", items: { type: "string" } },
      highlighted_themes: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            theme: { type: "string" },
            description: { type: "string" },
          },
          required: ["theme", "description"],
        },
      },
    },
    required: [
      "sentiment",
      "recurring_complaints",
      "requested_features",
      "highlighted_themes",
    ],
  },
};

const registrarAnalisisComparativoTool: Anthropic.Tool = {
  name: "registrar_analisis_comparativo",
  description:
    "Registra el análisis comparativo estructurado de las reseñas de varias apps del mismo tipo/categoría.",
  input_schema: {
    type: "object",
    properties: {
      apps_analyzed: {
        type: "array",
        items: {
          type: "object",
          properties: {
            trackId: { type: "number" },
            appName: { type: "string" },
            reviewCount: { type: "number" },
          },
          required: ["trackId", "appName", "reviewCount"],
        },
      },
      sample_warnings: { type: "array", items: { type: "string" } },
      dimension_rankings: {
        type: "array",
        minItems: 3,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            dimension: { type: "string" },
            ranking: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  appName: { type: "string" },
                  note: { type: "string" },
                },
                required: ["appName", "note"],
              },
            },
          },
          required: ["dimension", "ranking"],
        },
      },
      category_wide_complaints: { type: "array", items: { type: "string" } },
      differentiators: {
        type: "array",
        items: {
          type: "object",
          properties: {
            appName: { type: "string" },
            differentiator: { type: "string" },
          },
          required: ["appName", "differentiator"],
        },
      },
      conclusion: {
        type: "object",
        properties: {
          best_app: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["best_app", "reasoning"],
      },
    },
    required: [
      "apps_analyzed",
      "sample_warnings",
      "dimension_rankings",
      "category_wide_complaints",
      "differentiators",
      "conclusion",
    ],
  },
};

// Audit finding (ALV-93): tool_choice forcing Claude to call
// "registrar_analisis"/"registrar_analisis_comparativo" makes it call the
// tool, but nothing guarantees the resulting `input` actually matches the
// input_schema declared above (a missing field, a wrong type, a null where
// an array was required). Both dashboard components destructure `data`
// directly with no defensive checks (e.g. `sentiment.score`,
// `dimension.ranking[rankIndex].note`) and the app has no error.tsx
// boundary anywhere — an unvalidated malformed shape reaching the frontend
// would throw an uncaught TypeError at render time, which is exactly the
// kind of raw technical failure this project's error handling exists to
// prevent. These type guards run right after the tool_use block is found,
// before it's ever returned to the client, so a malformed shape is treated
// the same as "no tool_use block at all" — the existing, already-controlled
// "No se pudo generar el análisis con Claude" 502.
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isSingleAnalysisData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  const sentiment = v.sentiment as Record<string, unknown> | undefined;
  const sentimentOk =
    !!sentiment &&
    typeof sentiment === "object" &&
    ["positivo", "negativo", "mixto"].includes(sentiment.label as string) &&
    typeof sentiment.score === "number" &&
    Number.isFinite(sentiment.score) &&
    isNonEmptyString(sentiment.justification);

  return (
    sentimentOk &&
    isStringArray(v.recurring_complaints) &&
    isStringArray(v.requested_features) &&
    Array.isArray(v.highlighted_themes) &&
    v.highlighted_themes.every(
      (t) =>
        !!t &&
        typeof t === "object" &&
        isNonEmptyString((t as Record<string, unknown>).theme) &&
        isNonEmptyString((t as Record<string, unknown>).description)
    )
  );
}

function isComparativeAnalysisData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  const appsAnalyzedOk =
    Array.isArray(v.apps_analyzed) &&
    v.apps_analyzed.every((a) => {
      const app = a as Record<string, unknown>;
      return (
        !!app &&
        typeof app === "object" &&
        typeof app.trackId === "number" &&
        isNonEmptyString(app.appName) &&
        typeof app.reviewCount === "number"
      );
    });

  const dimensionRankingsOk =
    Array.isArray(v.dimension_rankings) &&
    v.dimension_rankings.every((d) => {
      const dim = d as Record<string, unknown>;
      return (
        !!dim &&
        typeof dim === "object" &&
        isNonEmptyString(dim.dimension) &&
        Array.isArray(dim.ranking) &&
        dim.ranking.every((r) => {
          const entry = r as Record<string, unknown>;
          return (
            !!entry &&
            typeof entry === "object" &&
            isNonEmptyString(entry.appName) &&
            isNonEmptyString(entry.note)
          );
        })
      );
    });

  const differentiatorsOk =
    Array.isArray(v.differentiators) &&
    v.differentiators.every((d) => {
      const diff = d as Record<string, unknown>;
      return (
        !!diff &&
        typeof diff === "object" &&
        isNonEmptyString(diff.appName) &&
        isNonEmptyString(diff.differentiator)
      );
    });

  const conclusion = v.conclusion as Record<string, unknown> | undefined;
  const conclusionOk =
    !!conclusion &&
    typeof conclusion === "object" &&
    isNonEmptyString(conclusion.best_app) &&
    isNonEmptyString(conclusion.reasoning);

  return (
    appsAnalyzedOk &&
    isStringArray(v.sample_warnings) &&
    dimensionRankingsOk &&
    isStringArray(v.category_wide_complaints) &&
    differentiatorsOk &&
    conclusionOk
  );
}

interface AnalyzeRequestBody {
  trackIds?: unknown;
  country?: string;
}

function isValidTrackIds(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_APPS &&
    value.every((id) => typeof id === "number" && Number.isFinite(id))
  );
}

export async function POST(request: NextRequest) {
  let body: AnalyzeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El body debe ser JSON válido" },
      { status: 400 }
    );
  }

  const country = body.country?.trim() || "cl";
  const trackIds = body.trackIds;

  if (!isValidTrackIds(trackIds)) {
    return NextResponse.json(
      { error: "trackIds debe ser un array de 1 a 5 elementos" },
      { status: 400 }
    );
  }

  // Fetch reviews for every app up front, in input order. This loop only
  // handles the network-failure case (502) — how few reviews is "too few"
  // depends on the mode (single vs. comparative), decided below.
  const reviewsByTrackId = new Map<number, ReviewsResult>();
  for (const trackId of trackIds) {
    let result: ReviewsResult;
    try {
      result = await fetchReviews(String(trackId), country);
    } catch {
      return NextResponse.json(
        { error: "No se pudo conectar con iTunes RSS" },
        { status: 502 }
      );
    }

    reviewsByTrackId.set(trackId, result);
  }

  // ---------------------------------------------------------------------
  // Single-app mode — unchanged behavior from before this endpoint accepted
  // multiple trackIds, just wrapped in { mode, data }.
  // ---------------------------------------------------------------------
  if (trackIds.length === 1) {
    const reviewsResult = reviewsByTrackId.get(trackIds[0])!;

    if (reviewsResult.reviews.length < MIN_REVIEWS_REQUIRED) {
      // Resolve the real name for the error message — same criterion
      // already used in comparative mode, so a business error never shows
      // a raw trackId to the user. Looked up lazily, only on this error
      // path, so the common (enough-reviews) case doesn't pay for it.
      let appName = `App ${trackIds[0]}`;
      try {
        const names = await lookupAppNames([trackIds[0]], country);
        appName = names.get(trackIds[0]) ?? appName;
      } catch {
        // Keep the placeholder — a name-lookup failure here shouldn't
        // turn an already-known 422 into a 502.
      }

      return NextResponse.json(
        {
          error: `${appName} no tiene suficientes reseñas para un análisis confiable`,
        },
        { status: 422 }
      );
    }

    const trimmedReviews = reviewsResult.reviews.slice(0, MAX_REVIEWS_SINGLE);

    const reviewsText = trimmedReviews
      .map(
        (review, index) =>
          `Reseña ${index + 1} (rating: ${review.rating}/5): "${review.content}"`
      )
      .join("\n\n");

    const promptText = `Analiza el siguiente conjunto de reseñas de una app y registra el resultado usando la herramienta "registrar_analisis".

Instrucciones:
- Responde TODO el contenido (label de sentiment, justification, recurring_complaints, requested_features, highlighted_themes) en español, sin importar el idioma original de las reseñas.
- El rating de cada reseña es una escala de 1 a 5 estrellas; el campo sentiment.score que debes generar es una escala independiente de 0 a 100 que refleja tu evaluación global del sentimiento, no una conversión directa del rating.
- Básate únicamente en lo que dicen las reseñas reales a continuación. No inventes quejas, features solicitadas ni temas que no estén respaldados por el contenido de las reseñas.

Reseñas (${trimmedReviews.length} en total):

${reviewsText}`;

    let response;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        tools: [registrarAnalisisTool],
        tool_choice: { type: "tool", name: "registrar_analisis" },
        messages: [{ role: "user", content: promptText }],
      });
    } catch (error) {
      console.error("Error calling Anthropic API:", error);
      return NextResponse.json(
        { error: "No se pudo generar el análisis con Claude" },
        { status: 502 }
      );
    }

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUseBlock || !isSingleAnalysisData(toolUseBlock.input)) {
      console.error(
        "[analyze] single mode: Claude's tool_use input didn't match the expected shape",
        toolUseBlock ? JSON.stringify(toolUseBlock.input) : "(no tool_use block)"
      );
      return NextResponse.json(
        { error: "No se pudo generar el análisis con Claude" },
        { status: 502 }
      );
    }

    return NextResponse.json({ mode: "single", data: toolUseBlock.input });
  }

  // ---------------------------------------------------------------------
  // Comparative mode — 2 to 5 apps.
  // ---------------------------------------------------------------------
  // Resolve names FIRST — every error/warning below must refer to apps by
  // name, never by raw trackId.
  let appNames: Map<number, string>;
  try {
    appNames = await lookupAppNames(trackIds, country);
  } catch {
    // Audit finding (ALV-93): lookupAppNames calls the iTunes Lookup API,
    // not the RSS reviews feed — this message named the wrong service
    // (harmless to the end user, who only sees generic phrasing either
    // way, but wrong for anyone debugging from the message itself).
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes Lookup API" },
      { status: 502 }
    );
  }

  const allAppsData = trackIds.map((trackId) => {
    const reviews = reviewsByTrackId.get(trackId)!.reviews;
    const appName = appNames.get(trackId) ?? `App ${trackId}`;
    return { trackId, appName, reviewCount: reviews.length, reviews };
  });

  // Apps with 0 reviews have nothing to contribute — exclude them from the
  // set sent to Claude rather than rejecting the whole comparison.
  const excludedApps = allAppsData.filter((a) => a.reviewCount === 0);
  const includedApps = allAppsData.filter(
    (a) => a.reviewCount >= MIN_REVIEWS_COMPARATIVE
  );

  if (includedApps.length < 2) {
    const excludedNames = excludedApps.map((a) => a.appName).join(", ");
    return NextResponse.json(
      {
        error: `No quedaron suficientes apps con reseñas disponibles para comparar (se excluyó a ${excludedNames} por no tener reseñas).`,
      },
      { status: 422 }
    );
  }

  const appsData = includedApps.map((a) => ({
    trackId: a.trackId,
    appName: a.appName,
    reviewCount: a.reviewCount,
    trimmedReviews: a.reviews.slice(0, MAX_REVIEWS_PER_APP_COMPARATIVE),
  }));

  // Precompute sample-size warnings deterministically — comparing raw
  // reviewCount is exact arithmetic, not something to leave to the model.
  // Two independent checks, but an app under LOW_REVIEW_THRESHOLD is
  // *also* almost always under the ratio cutoff — only emit the more
  // specific low-volume message in that case instead of stacking two
  // near-duplicate warnings for the same app.
  const maxReviewCount = Math.max(...appsData.map((a) => a.reviewCount));
  const sampleWarnings: string[] = [];

  for (const a of appsData) {
    if (a.reviewCount < LOW_REVIEW_THRESHOLD) {
      sampleWarnings.push(
        `${a.appName} tiene solo ${a.reviewCount} reseñas disponibles — su análisis es menos representativo y debe tomarse con cautela.`
      );
    } else if (a.reviewCount < maxReviewCount * LOW_VOLUME_RATIO_THRESHOLD) {
      sampleWarnings.push(
        `${a.appName} tiene solo ${a.reviewCount} reseñas disponibles, muy por debajo de las ${maxReviewCount} de la app con más reseñas del set — sus resultados son menos representativos.`
      );
    }
  }

  for (const a of excludedApps) {
    sampleWarnings.push(
      `${a.appName} fue excluida de la comparación porque no tiene reseñas disponibles.`
    );
  }

  const appsListText = appsData
    .map(
      (a) =>
        `- trackId ${a.trackId} | appName "${a.appName}" | reviewCount ${a.reviewCount}`
    )
    .join("\n");

  const reviewsBlocks = appsData
    .map((app) => {
      const reviewsText = app.trimmedReviews
        .map(
          (review, index) =>
            `Reseña ${index + 1} (rating: ${review.rating}/5): "${review.content}"`
        )
        .join("\n\n");
      return `--- Reseñas de ${app.appName} ---\n\n${reviewsText}`;
    })
    .join("\n\n");

  const promptText = `Vas a comparar ${appsData.length} apps del mismo tipo/categoría a partir de sus reseñas reales. Registra el resultado usando la herramienta "registrar_analisis_comparativo".

Apps del set:
${appsListText}

Instrucciones:
- Responde TODO el contenido en español.
- En apps_analyzed, reporta exactamente el trackId, appName y reviewCount de cada app tal como se listan arriba — no los recalcules ni los cambies.
- En dimension_rankings, elige entre 3 y 4 dimensiones relevantes para este tipo de app (por ejemplo: estabilidad/bugs, catálogo o contenido, valor por precio, publicidad, soporte, facilidad de uso) y en cada dimensión ordena TODAS las ${appsData.length} apps del set de mejor a peor — no menciones solo a la ganadora.
- category_wide_complaints debe incluir únicamente quejas que aparezcan en varias apps del set, no quejas específicas de una sola app.
- sample_warnings: usa exactamente esta lista precalculada, sin modificarla ni inventar otras advertencias: ${JSON.stringify(sampleWarnings)}. Si la lista está vacía, deja sample_warnings como un array vacío.
- conclusion: al final, elige UNA sola app como la mejor del set — best_app debe ser exactamente igual (carácter por carácter) a uno de los appName listados arriba, nunca una app inventada ni una combinación de varias. El reasoning debe ser una síntesis de lo que ya concluiste en dimension_rankings, category_wide_complaints y differentiators — no introduzcas criterios nuevos ni información que no se desprenda de esas secciones. Escríbelo en español, en 2 a 4 frases concretas, mencionando en qué dimensiones destaca la app elegida y por qué supera a las demás del set.
- Básate únicamente en lo que dicen las reseñas reales a continuación. No inventes quejas, diferenciadores, rankings ni conclusiones que no estén respaldados por el contenido.

${reviewsBlocks}`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 3584,
      tools: [registrarAnalisisComparativoTool],
      tool_choice: { type: "tool", name: "registrar_analisis_comparativo" },
      messages: [{ role: "user", content: promptText }],
    });
  } catch (error) {
    console.error("Error calling Anthropic API:", error);
    return NextResponse.json(
      { error: "No se pudo generar el análisis con Claude" },
      { status: 502 }
    );
  }

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUseBlock || !isComparativeAnalysisData(toolUseBlock.input)) {
    console.error(
      "[analyze] comparative mode: Claude's tool_use input didn't match the expected shape",
      toolUseBlock ? JSON.stringify(toolUseBlock.input) : "(no tool_use block)"
    );
    return NextResponse.json(
      { error: "No se pudo generar el análisis con Claude" },
      { status: 502 }
    );
  }

  return NextResponse.json({ mode: "comparative", data: toolUseBlock.input });
}
