import { Text, View } from "@react-pdf/renderer";
import { COLORS, styles } from "./styles";

/**
 * ALV-84: small building blocks shared by SingleAnalysisPdf and
 * ComparativeAnalysisPdf, so both documents' header/bullet-list/footer
 * treatment can never drift apart (same intent as AccordionSection being
 * shared by the two on-screen dashboards).
 */

export function PdfHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerBrand}>BENCHMARK REVIEW INTELLIGENCE · CHILE</Text>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerMeta}>{meta}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function BulletList({
  items,
  emptyText,
}: {
  items: string[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <Text style={styles.emptyNote}>{emptyText}</Text>;
  }

  return (
    <View>
      {items.map((item, index) => (
        <View style={styles.bulletRow} key={index}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function PdfFooter() {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) =>
        `Benchmark Review Intelligence · Chile — Página ${pageNumber} de ${totalPages}`
      }
    />
  );
}

export function sentimentColor(score: number): string {
  if (score < 40) return COLORS.negative;
  if (score <= 70) return COLORS.neutral;
  return COLORS.positive;
}
