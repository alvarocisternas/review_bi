// Apps that must always stay synced (metadata + reviews) regardless of
// whether they'd naturally place in their category's real top 50 by
// rating — unlike the carousel/category seed, membership here isn't
// rating-driven. Each trackId below was resolved once against the live
// iTunes Search API (country=CL), the same verification method used for
// lib/carouselApps.ts, confirmed by artistName/trackName — never assumed
// from memory. See the task report for the full resolution table.
//
// Rows for these apps are stored with source='seed_guaranteed', and the
// sync cron's Part A (app/api/cron/sync-apps) includes that source in its
// rotation alongside seed_carousel/seed_category.
export interface GuaranteedApp {
  name: string;
  trackId: number;
}

export const GUARANTEED_APPS: GuaranteedApp[] = [
  // The app whose missing-reviews bug (ALV-85) this list exists to guard
  // against long-term — a huge, obviously-important Chilean bank app that
  // still isn't guaranteed to land in Finance's top 50 by rating alone.
  { name: "Santander Chile", trackId: 604982236 },
  // Fintoc — the carousel already includes this trackId under the name
  // "Fintoc" (lib/carouselApps.ts); its real iTunes trackName is
  // "Fintoc Me". Listed here too so it's explicit that this is one of the
  // guaranteed fintech competitors, not just an incidental carousel pick.
  { name: "Fintoc Me", trackId: 6744977430 },
  // Direct payments/transfers fintech competitors in Chile:
  { name: "Tenpo", trackId: 1480047892 }, // "Tenpo: primer neobanco Chile", Tenpo SpA
  { name: "MACH", trackId: 1262116570 }, // "MACHBANK: Banca Digital", Banco Crédito e Inversiones (BCI)
  { name: "Fintual", trackId: 1485050953 }, // "Fintual: Invierte y ahorra", Fintual — also already in the carousel
  // "Chek" was NOT included (ALV-86, resolved as not applicable). Two
  // rounds of searching confirm this isn't a lookup miss:
  //   - Round 1 assumed it was Banco de Chile's product — searched "Chek",
  //     "Chek Banco de Chile", "Chek billetera", "Chek app chile", and
  //     browsed every Banco de Chile-published app on the Chilean App
  //     Store (Mi Banco Chile, Mi_Pass, Mi Banconexión, Mi Inversión). No
  //     match.
  //   - Round 2 corrected the developer to Banco Ripley (Chek's actual
  //     owner) and tried the exact claimed trackId (1483977376 — resolves
  //     to resultCount:0, not a real app) plus "chek", "chek cuenta",
  //     "chek billetera", "chek app", "chek wallet", "chek digital",
  //     "cuenta 100% digital", and "banco ripley" against the live iTunes
  //     Search API (country=CL). No result named "Chek - Cuenta 100%
  //     digital" or attributed to Banco Ripley turned up; Banco Ripley's
  //     only CL App Store listing is "Banco Ripley Chile" (trackId
  //     1287625215).
  // Root cause: Chek was Banco Ripley's digital wallet but only ever
  // shipped on Google Play (cl.dalechek.app) — no iOS app ever existed —
  // and Banco Ripley announced its shutdown, folding it back into the
  // bank as of 2026-05-31 (https://www.emol.com/noticias/Economia/2025/02/20/1158112/banco-ripley-cierra-chek.html).
  // There is no valid trackId to add.
];
