import { NextRequest, NextResponse } from "next/server";
import { fetchReviews } from "@/lib/reviews";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const searchParams = request.nextUrl.searchParams;

  const country = searchParams.get("country")?.trim() || "cl";
  const pageParam = searchParams.get("page")?.trim();
  const page = pageParam && !isNaN(Number(pageParam)) ? Number(pageParam) : 1;

  try {
    const result = await fetchReviews(trackId, country, page);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "No se pudo conectar con iTunes RSS" },
      { status: 502 }
    );
  }
}
