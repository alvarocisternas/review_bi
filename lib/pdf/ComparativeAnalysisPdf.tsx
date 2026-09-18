import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { styles } from "./styles";
import { BulletList, PdfFooter, PdfHeader } from "./PdfPrimitives";

// ALV-84: shape matches ComparativeDashboard's ComparativeAnalysisData (the
// actual /api/analyze comparative-mode response) — redeclared here for the
// same reason as SingleAnalysisPdfData: this server render path never
// depends on a client component module.
export interface ComparativeAnalysisPdfData {
  apps_analyzed: { trackId: number; appName: string; reviewCount: number }[];
  sample_warnings: string[];
  dimension_rankings: {
    dimension: string;
    ranking: { appName: string; note: string }[];
  }[];
  category_wide_complaints: string[];
  differentiators: { appName: string; differentiator: string }[];
  conclusion: { best_app: string; reasoning: string };
}

export interface ComparativeAnalysisPdfProps {
  generatedAt: string;
  data: ComparativeAnalysisPdfData;
}

// react-pdf has no native table primitive — this is the standard
// flexbox-row approach: a fixed-width first column (dimension name) plus
// one flex:1 column per app, so the table always fills the page width no
// matter how many apps (2-5) are in the set.
const TABLE_LABEL_COL_WIDTH = "20%";

function ComparativeAnalysisPdf({ generatedAt, data }: ComparativeAnalysisPdfProps) {
  const {
    apps_analyzed,
    sample_warnings,
    dimension_rankings,
    category_wide_complaints,
    differentiators,
    conclusion,
  } = data;

  return (
    <Document title="Comparativa de apps">
      <Page size="A4" style={styles.page}>
        <PdfHeader
          title={`Comparativa de ${apps_analyzed.length} apps`}
          meta={`Análisis comparativo · Generado el ${generatedAt}`}
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Apps analizadas</Text>
          {apps_analyzed.map((app) => (
            <View style={styles.bulletRow} key={app.trackId}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={styles.bulletText}>
                {app.appName} — {app.reviewCount} reseña
                {app.reviewCount === 1 ? "" : "s"} analizada
                {app.reviewCount === 1 ? "" : "s"}
              </Text>
            </View>
          ))}
          {sample_warnings.length > 0 && (
            <View style={{ marginTop: 6 }}>
              {sample_warnings.map((warning, index) => (
                <Text
                  key={index}
                  style={{ fontSize: 8, color: "#a16207", marginBottom: 2 }}
                >
                  ⚠ {warning}
                </Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Comparación por dimensión</Text>
          <View
            style={{
              flexDirection: "row",
              backgroundColor: "#f4f4f5",
              paddingVertical: 4,
              paddingHorizontal: 2,
            }}
          >
            <Text
              style={{
                width: TABLE_LABEL_COL_WIDTH,
                fontSize: 9,
                fontFamily: "Helvetica-Bold",
              }}
            >
              Dimensión
            </Text>
            {apps_analyzed.map((app) => (
              <Text
                key={app.trackId}
                style={{ flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold" }}
              >
                {app.appName}
              </Text>
            ))}
          </View>
          {dimension_rankings.map((dimension, rowIndex) => (
            <View
              key={rowIndex}
              style={{
                flexDirection: "row",
                paddingVertical: 5,
                paddingHorizontal: 2,
                borderBottomWidth: 1,
                borderBottomColor: "#e4e4e7",
                borderBottomStyle: "solid",
              }}
            >
              <Text
                style={{
                  width: TABLE_LABEL_COL_WIDTH,
                  fontSize: 9,
                  fontFamily: "Helvetica-Bold",
                }}
              >
                {dimension.dimension}
              </Text>
              {apps_analyzed.map((app) => {
                const rankIndex = dimension.ranking.findIndex(
                  (entry) => entry.appName === app.appName
                );
                if (rankIndex === -1) {
                  return (
                    <Text key={app.trackId} style={{ flex: 1, fontSize: 8, color: "#a1a1aa" }}>
                      —
                    </Text>
                  );
                }
                return (
                  <View key={app.trackId} style={{ flex: 1, paddingRight: 4 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold" }}>
                      {rankIndex + 1}°
                    </Text>
                    <Text style={{ fontSize: 8, color: "#71717a", lineHeight: 1.3 }}>
                      {dimension.ranking[rankIndex].note}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quejas comunes a la categoría</Text>
          <BulletList
            items={category_wide_complaints}
            emptyText="No se detectaron quejas comunes entre estas apps."
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Qué distingue a cada app</Text>
          {differentiators.map((item, index) => (
            <View style={styles.bulletRow} key={index}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={styles.bulletText}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{item.appName}: </Text>
                {item.differentiator}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Conclusión</Text>
          <View
            style={{
              backgroundColor: "#f4f4f5",
              borderRadius: 6,
              padding: 10,
            }}
          >
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>
              {conclusion.best_app}
            </Text>
            <Text style={[styles.paragraph, { marginTop: 4 }]}>
              {conclusion.reasoning}
            </Text>
          </View>
        </View>

        <PdfFooter />
      </Page>
    </Document>
  );
}

export async function renderComparativeAnalysisPdf(
  props: ComparativeAnalysisPdfProps
): Promise<Buffer> {
  return renderToBuffer(<ComparativeAnalysisPdf {...props} />);
}
