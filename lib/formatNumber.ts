// ALV-84: any raw integer shown to the user (rating counts, review counts)
// must use es-CL thousands separators — Intl.NumberFormat handles locale
// grouping correctly (e.g. 36849 -> "36.849") instead of a manual regex.
const numberFormatterCl = new Intl.NumberFormat("es-CL");

export function formatCount(value: number): string {
  return numberFormatterCl.format(value);
}
