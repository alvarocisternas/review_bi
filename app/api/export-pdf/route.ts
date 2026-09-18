import { NextRequest, NextResponse } from "next/server";
import {
  renderSingleAnalysisPdf,
  SingleAnalysisPdfData,
} from "@/lib/pdf/SingleAnalysisPdf";
import {
  renderComparativeAnalysisPdf,
  ComparativeAnalysisPdfData,
} from "@/lib/pdf/ComparativeAnalysisPdf";

// ALV-84: @react-pdf/renderer uses Node APIs (Buffer, fontkit's fs reads)
// under the hood — not Edge-compatible. Route Handlers default to the
// Node.js runtime already, but this is worth stating explicitly given
// what actually breaks if it ever changed.
export const runtime = "nodejs";

// Same shape-validation approach as app/api/analyze/route.ts's
// isSingleAnalysisData/isComparativeAnalysisData (ALV-93): this endpoint's
// body is normally just the client echoing back /api/analyze's own
// response, but it's still untrusted input from the client's perspective —
// a malformed shape must fail with a clean 400, never an uncaught
// exception surfacing as a raw stack trace.
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isSingleAnalysisPdfData(value: unknown): value is SingleAnalysisPdfData {
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
    v.highlighted_themes.every((t) => {
      const theme = t as Record<string, unknown>;
      return (
        !!theme &&
        typeof theme === "object" &&
        isNonEmptyString(theme.theme) &&
        isNonEmptyString(theme.description)
      );
    })
  );
}

function isComparativeAnalysisPdfData(
  value: unknown
): value is ComparativeAnalysisPdfData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  const appsAnalyzedOk =
    Array.isArray(v.apps_analyzed) &&
    v.apps_analyzed.length > 0 &&
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

interface ExportPdfRequestBody {
  mode?: unknown;
  data?: unknown;
  appName?: unknown;
}

const MAX_FILENAME_APPS = 3;

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (á -> a, ñ -> n, ...)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDateEs(): string {
  return new Date().toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function pdfResponse(buffer: Buffer, filename: string): NextResponse {
  // BodyInit's DOM typing doesn't structurally match Node's Buffer (despite
  // Buffer being a real Uint8Array at runtime) — wrapping it copies the
  // bytes into a plain Uint8Array, which does satisfy it. The PDFs this
  // endpoint produces are small (single-digit KB), so the copy is cheap.
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function POST(request: NextRequest) {
  let body: ExportPdfRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El body debe ser JSON válido" },
      { status: 400 }
    );
  }

  if (body.mode === "single") {
    if (!isSingleAnalysisPdfData(body.data)) {
      return NextResponse.json(
        { error: "El resultado de análisis no tiene el formato esperado" },
        { status: 400 }
      );
    }

    const appName =
      isNonEmptyString(body.appName) && body.appName.trim().length > 0
        ? body.appName.trim()
        : "App analizada";

    let buffer: Buffer;
    try {
      buffer = await renderSingleAnalysisPdf({
        appName,
        generatedAt: formatDateEs(),
        data: body.data,
      });
    } catch (error) {
      console.error("[export-pdf] single mode render failed:", error);
      return NextResponse.json(
        { error: "No se pudo generar el PDF" },
        { status: 500 }
      );
    }

    return pdfResponse(buffer, `analisis-${slugify(appName) || "app"}.pdf`);
  }

  if (body.mode === "comparative") {
    if (!isComparativeAnalysisPdfData(body.data)) {
      return NextResponse.json(
        { error: "El resultado de análisis no tiene el formato esperado" },
        { status: 400 }
      );
    }

    let buffer: Buffer;
    try {
      buffer = await renderComparativeAnalysisPdf({
        generatedAt: formatDateEs(),
        data: body.data,
      });
    } catch (error) {
      console.error("[export-pdf] comparative mode render failed:", error);
      return NextResponse.json(
        { error: "No se pudo generar el PDF" },
        { status: 500 }
      );
    }

    const appNames = body.data.apps_analyzed
      .slice(0, MAX_FILENAME_APPS)
      .map((a) => slugify(a.appName))
      .filter((slug) => slug.length > 0);
    const filename =
      appNames.length > 0
        ? `comparativa-${appNames.join("-")}.pdf`
        : `comparativa-${body.data.apps_analyzed.length}-apps-${todayStamp()}.pdf`;

    return pdfResponse(buffer, filename);
  }

  return NextResponse.json(
    { error: "mode debe ser 'single' o 'comparative'" },
    { status: 400 }
  );
}
