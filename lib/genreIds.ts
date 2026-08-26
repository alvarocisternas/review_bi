/**
 * Apple App Store genre IDs, validated against the legacy
 * itunes.apple.com/{country}/rss/topfreeapplications/... feed, which is
 * the only chart endpoint that actually honors genre filtering (see
 * docs/api-shapes/itunes-charts-example.json for context on why).
 *
 * Each ID below was confirmed by requesting
 * itunes.apple.com/us/rss/topfreeapplications/limit=3/genre={id}/json
 * and checking that every returned entry's category.attributes.term
 * matches the expected name exactly.
 */
export const GENRE_IDS: Record<string, number> = {
  Games: 6014,
  Business: 6000,
  Education: 6017,
  Entertainment: 6016,
  Finance: 6015,
  "Health & Fitness": 6013,
  Productivity: 6007,
  Shopping: 6024,
  "Social Networking": 6005,
  Travel: 6003,
  News: 6009,
  Utilities: 6002,
  "Photo & Video": 6008,
  Music: 6011,
  Lifestyle: 6012,
};

/**
 * Spanish display labels for GENRE_IDS' keys — UI-only. The English key
 * remains the internal identifier sent to /api/top-apps?genre= and
 * validated there; never translate the keys themselves.
 */
export const GENRE_LABELS_ES: Record<string, string> = {
  Games: "Juegos",
  Business: "Negocios",
  Education: "Educación",
  Entertainment: "Entretenimiento",
  Finance: "Finanzas",
  "Health & Fitness": "Salud y bienestar",
  Productivity: "Productividad",
  Shopping: "Compras",
  "Social Networking": "Redes sociales",
  Travel: "Viajes",
  News: "Noticias",
  Utilities: "Utilidades",
  "Photo & Video": "Foto y video",
  Music: "Música",
  Lifestyle: "Estilo de vida",
};
