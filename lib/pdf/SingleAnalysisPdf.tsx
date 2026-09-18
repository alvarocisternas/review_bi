import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { styles } from "./styles";
import { BulletList, PdfFooter, PdfHeader, sentimentColor } from "./PdfPrimitives";

// ALV-84: shape matches AnalysisDashboard's SingleAnalysisData (the actual
// /api/analyze single-mode response) — redeclared here rather than
// imported from that "use client" component so this server-side render
// path never depends on a client component module.
export interface SingleAnalysisPdfData {
  sentiment: {
    label: "positivo" | "negativo" | "mixto";
    score: number;
    justification: string;
  };
  recurring_complaints: string[];
  requested_features: string[];
  highlighted_themes: { theme: string; description: string }[];
}

export interface SingleAnalysisPdfProps {
  appName: string;
  generatedAt: string;
  data: SingleAnalysisPdfData;
}

function SingleAnalysisPdf({ appName, generatedAt, data }: SingleAnalysisPdfProps) {
  const { sentiment, recurring_complaints, requested_features, highlighted_themes } =
    data;

  return (
    <Document title={`Análisis - ${appName}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader
          title={appName}
          meta={`Análisis individual · Generado el ${generatedAt}`}
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sentimiento general</Text>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: "Helvetica-Bold",
                textTransform: "capitalize",
              }}
            >
              {sentiment.label}
            </Text>
            <Text style={{ fontSize: 10, color: "#52525b" }}>
              {sentiment.score}/100
            </Text>
          </View>
          <View style={{ height: 8, backgroundColor: "#f4f4f5", borderRadius: 4 }}>
            <View
              style={{
                height: 8,
                width: `${sentiment.score}%`,
                backgroundColor: sentimentColor(sentiment.score),
                borderRadius: 4,
              }}
            />
          </View>
          <Text style={[styles.paragraph, { marginTop: 6 }]}>
            {sentiment.justification}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quejas recurrentes</Text>
          <BulletList
            items={recurring_complaints}
            emptyText="No se detectaron quejas recurrentes."
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Features más pedidas</Text>
          <BulletList
            items={requested_features}
            emptyText="No se detectaron features pedidas."
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temas destacados</Text>
          {highlighted_themes.map((theme, index) => (
            <View key={index} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>
                {theme.theme}
              </Text>
              <Text style={styles.paragraph}>{theme.description}</Text>
            </View>
          ))}
        </View>

        <PdfFooter />
      </Page>
    </Document>
  );
}

export async function renderSingleAnalysisPdf(
  props: SingleAnalysisPdfProps
): Promise<Buffer> {
  return renderToBuffer(<SingleAnalysisPdf {...props} />);
}
