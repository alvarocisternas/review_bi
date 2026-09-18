import { StyleSheet } from "@react-pdf/renderer";

// ALV-84: shared, deliberately plain PDF styling — no custom fonts (the
// react-pdf default, Helvetica, already covers Spanish accents/ñ; see the
// task report for the render smoke test that confirmed this), just enough
// visual hierarchy to read well printed or on screen.
export const COLORS = {
  text: "#18181b",
  subtext: "#52525b",
  muted: "#a1a1aa",
  border: "#e4e4e7",
  headerBg: "#18181b",
  headerText: "#fafafa",
  positive: "#16a34a",
  neutral: "#ca8a04",
  negative: "#dc2626",
  boxBg: "#f4f4f5",
};

export const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    color: COLORS.text,
    fontFamily: "Helvetica",
  },
  header: {
    backgroundColor: COLORS.headerBg,
    borderRadius: 6,
    padding: 14,
    marginBottom: 18,
  },
  headerBrand: {
    fontSize: 10,
    color: COLORS.headerText,
    opacity: 0.75,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLORS.headerText,
  },
  headerMeta: {
    fontSize: 9,
    color: COLORS.headerText,
    opacity: 0.75,
    marginTop: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLORS.text,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderBottomStyle: "solid",
  },
  paragraph: {
    fontSize: 10,
    color: COLORS.subtext,
    lineHeight: 1.5,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bulletMark: {
    width: 10,
    fontSize: 10,
    color: COLORS.text,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: COLORS.subtext,
    lineHeight: 1.4,
  },
  emptyNote: {
    fontSize: 9,
    color: COLORS.muted,
    fontFamily: "Helvetica-Oblique",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: COLORS.muted,
    textAlign: "center",
  },
});
