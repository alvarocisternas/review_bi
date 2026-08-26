import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchReviews, ReviewsResult } from "@/lib/reviews";
import { lookupAppNames } from "@/lib/appLookup";

const client = new Anthropic();

const MAX_REVIEWS_SINGLE = 50;
const MAX_REVIEWS_PER_APP_COMPARATIVE = 30;
const MIN_REVIEWS_REQUIRED = 5;
const MAX_APPS = 5;
const LOW_VOLUME_RATIO_THRESHOLD = 0.3;

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

  const country = body.country?.trim() || "us";
  const trackIds = body.trackIds;

  if (!isValidTrackIds(trackIds)) {
    return NextResponse.json(
      { error: "trackIds debe ser un array de 1 a 5 elementos" },
      { status: 400 }
    );
  }

  // Fetch reviews for every app up front, in input order, so a 502/422
  // always reports the first problematic trackId deterministically.
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

    if (result.reviews.length < MIN_REVIEWS_REQUIRED) {
      return NextResponse.json(
        {
          error: `La app ${trackId} no tiene suficientes reseñas para un análisis confiable`,
        },
        { status: 422 }
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

    if (!toolUseBlock) {
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
  let appNames: Map<number, string>;
  try {
    appNames = await lookupAppNames(trackIds);
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes RSS" },
      { status: 502 }
    );
  }

  const appsData = trackIds.map((trackId) => {
    const reviews = reviewsByTrackId.get(trackId)!.reviews;
    const trimmedReviews = reviews.slice(0, MAX_REVIEWS_PER_APP_COMPARATIVE);
    const appName = appNames.get(trackId) ?? `App ${trackId}`;
    return { trackId, appName, reviewCount: reviews.length, trimmedReviews };
  });

  // Precompute sample-size warnings deterministically — comparing raw
  // reviewCount is exact arithmetic, not something to leave to the model.
  const maxReviewCount = Math.max(...appsData.map((a) => a.reviewCount));
  const sampleWarnings = appsData
    .filter((a) => a.reviewCount < maxReviewCount * LOW_VOLUME_RATIO_THRESHOLD)
    .map(
      (a) =>
        `${a.appName} tiene solo ${a.reviewCount} reseñas disponibles, muy por debajo de las ${maxReviewCount} de la app con más reseñas del set — sus resultados son menos representativos.`
    );

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

  if (!toolUseBlock) {
    return NextResponse.json(
      { error: "No se pudo generar el análisis con Claude" },
      { status: 502 }
    );
  }

  return NextResponse.json({ mode: "comparative", data: toolUseBlock.input });
}
