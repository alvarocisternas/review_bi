import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchReviews } from "@/lib/reviews";

const client = new Anthropic();

const MAX_REVIEWS_FOR_ANALYSIS = 50;
const MIN_REVIEWS_REQUIRED = 5;

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

interface AnalyzeRequestBody {
  trackId: number;
  country?: string;
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

  const { trackId } = body;
  const country = body.country?.trim() || "us";

  if (trackId == null || isNaN(Number(trackId))) {
    return NextResponse.json(
      { error: "trackId is required" },
      { status: 400 }
    );
  }

  let reviewsResult;
  try {
    reviewsResult = await fetchReviews(String(trackId), country);
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes RSS" },
      { status: 502 }
    );
  }

  if (reviewsResult.reviews.length < MIN_REVIEWS_REQUIRED) {
    return NextResponse.json(
      { error: "No hay suficientes reseñas para generar un análisis confiable" },
      { status: 422 }
    );
  }

  const trimmedReviews = reviewsResult.reviews.slice(
    0,
    MAX_REVIEWS_FOR_ANALYSIS
  );

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

  return NextResponse.json(toolUseBlock.input);
}
