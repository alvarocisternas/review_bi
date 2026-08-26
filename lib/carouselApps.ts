// Fixed, curated list of apps shown in the decorative logo carousel above the
// search UI. Each entry was resolved once (trackId + artworkUrl100) via
// /api/search-app and a batched itunes.apple.com/lookup call against the
// Chilean storefront (country=CL) during development — see the task report
// for the full resolution table. This list is intentionally NOT fetched at
// runtime: the order below was shuffled once (a single Fisher-Yates pass)
// and hardcoded, so every page load and every reload shows the exact same
// sequence — unlike the old category-sampling carousel, which re-fetched and
// re-shuffled on every load.
export interface CarouselApp {
  name: string;
  trackId: number;
  artworkUrl100: string;
}

export const CAROUSEL_APPS: CarouselApp[] = [
  {
    name: "The Economist: News & Analysis",
    trackId: 1239397626,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/8f/43/35/8f433569-998a-1aff-41b7-a72236858866/AppIcon-0-0-1x_U007epad-0-0-0-1-0-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Claude",
    trackId: 6473753684,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/5b/4e/54/5b4e5448-017d-e993-a759-be4853032f37/AppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "Habla inglés con Loora AI",
    trackId: 1552708303,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cd/ab/29/cdab2963-7b3c-c37a-89f3-323b9161ba21/AppIcon-0-0-1x_U007ephone-0-1-0-sRGB-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "ChatGPT",
    trackId: 6448311069,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/62/11/63/6211631a-f4ca-980d-ccdc-ac8f052e4662/AppIcon-0-0-1x_U007epad-0-0-0-1-0-P3-85-220.png/100x100bb.jpg",
  },
  {
    name: "Fitia",
    trackId: 1448277011,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/af/82/80/af828099-e5d0-d11e-8b21-db5893ff3694/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "PedidosYa Rider",
    trackId: 1612663454,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/d7/b6/e2/d7b6e2b2-d4e3-9296-da29-1f1a09dcfe9d/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "LinkedIn",
    trackId: 288429040,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/23/c9/20/23c9204e-bb93-723f-fdf5-1ac93d55ec09/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "BeReal",
    trackId: 1459645446,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/42/ff/b3/42ffb346-f4d7-3ced-96b0-124b5248e169/AppIcon-0-0-1x_U007emarketing-0-6-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Instagram",
    trackId: 389801252,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/23/59/e9/2359e92d-376c-cc29-b9e6-ab9a4a00fcf4/Prod-0-0-1x_U007epad-0-1-0-sRGB-85-220.png/100x100bb.jpg",
  },
  {
    name: "Prex Chile - Cuenta Digital",
    trackId: 6478332507,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/6b/44/86/6b44869b-36b6-9ff3-d4c1-be7a777f82db/AppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "Fly Delta",
    trackId: 388491656,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/35/92/0f/35920f03-07c5-cc3c-eeaf-c2d9c109f9f3/Icon-0-0-1x_U007emarketing-0-0-0-8-0-0-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Math Puzzle Games - Cross Math",
    trackId: 1671991909,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/d6/f8/bd/d6f8bd1b-e172-ec77-760b-2a2ccd886777/AppIcon-1x_U007emarketing-0-11-0-85-220-0.png/100x100bb.jpg",
  },
  {
    name: "Pinterest",
    trackId: 429047995,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/c6/5c/d0/c65cd0fa-3084-bcfb-6239-f50c8f05c8d8/AppIcon-0-0-1x_U007epad-0-1-0-0-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Fintual",
    trackId: 1485050953,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/43/33/86/43338654-b310-4e41-fd7c-904aae20f621/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "Copec",
    trackId: 699938289,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ed/bd/f3/edbdf390-3613-09c5-2943-550c7b5e1130/AppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "Fiverr - Servicios freelance",
    trackId: 346080608,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3f/02/83/3f0283d8-4bde-9a6b-0e7f-d02080f747f2/AppIcon-0-0-1x_U007emarketing-0-0-0-8-0-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "TikTok",
    trackId: 835599320,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b4/f6/9e/b4f69e23-a20c-784c-7f41-400fd8ab3d1c/TikTok_AppIcon26-0-0-1x_U007epad-0-1-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Spotify",
    trackId: 324684580,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/78/d3/2a/78d32a70-87dc-58e9-86c7-04b87c88f873/AppIcon-0-0-1x_U007epad-0-1-0-0-sRGB-85-220.png/100x100bb.jpg",
  },
  {
    name: "Uber",
    trackId: 368677368,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/67/e8/04/67e804e4-d3b7-f7a0-2392-cbf1108b3963/AppIcon-0-0-1x_U007emarketing-0-8-0-0-85-220.png/100x100bb.jpg",
  },
  {
    name: "Fintoc",
    trackId: 6744977430,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/bb/d2/07/bbd207c0-dc9c-e6b6-203b-1c56143cb313/AppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg",
  },
  {
    name: "Jewel Coloring",
    trackId: 6759081967,
    artworkUrl100:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/7b/98/a5/7b98a54a-6b1e-a098-4b22-96199c4c93ab/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/100x100bb.jpg",
  },
];
