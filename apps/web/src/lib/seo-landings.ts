/**
 * SEO keyword landing-page registry (data-driven — one route renders all of them).
 *
 * Strategy (approved 2026-06-16): capture the full keyword map in code, but only
 * INDEX the pages backed by real inventory (`launched: true`) — those go in the
 * sitemap and are crawlable. The rest are built but `noindex` + excluded from the
 * sitemap (dormant) until their category/inventory exists; flip `launched` to turn
 * one on. This avoids thin/"doorway" pages while keeping the strategy ready to scale.
 *
 * Each page filters activities by either a real category slug OR a free-text
 * `search` keyword (search is precise across the broad live categories). Pages
 * render their SEO copy + a server-rendered grid of matching activities (graceful
 * empty state) + internal links + ItemList/BreadcrumbList JSON-LD.
 *
 * Bilingual: copy renders EN/AR via the existing cookie i18n; only EN URLs are
 * indexed for now (per-language /ar/ URLs are the deferred P1#4 migration).
 */

export type LandingLang = 'en' | 'ar';

export interface LandingCopy {
  h1: string;
  intro: string;
  metaTitle: string;
  metaDescription: string;
}

export interface SeoLanding {
  slug: string;
  cluster: string;
  /** How to surface matching activities: a real category slug OR a free-text search. */
  filter: { category?: string; search?: string };
  /** Indexed + in sitemap only when true. Others are built but noindex (dormant). */
  launched: boolean;
  /** Sitemap priority (used only when launched). */
  priority: number;
  /** Related LAUNCHED landing slugs for internal links (filtered to launched at render). */
  related: string[];
  /** Primary keyword — drives the templated fallback copy for unlaunched pages. */
  keyword: string;
  keywordAr: string;
  /** Full bilingual copy for launched pages; unlaunched derive from the keyword. */
  copy?: Partial<Record<LandingLang, LandingCopy>>;
}

export const SEO_LANDINGS: SeoLanding[] = [
  // ───────────── LAUNCHED (indexed + sitemap) — backed by real inventory ─────────────
  {
    slug: 'desert-safari-qatar',
    cluster: 'desert',
    filter: { category: 'leisure-fun' },
    launched: true,
    priority: 0.8,
    related: ['caravan-rental-qatar', 'water-activities-qatar'],
    keyword: 'Desert Safari Qatar',
    keywordAr: 'سفاري الصحراء في قطر',
    copy: {
      en: {
        h1: 'Desert Safari & Camping in Qatar',
        intro:
          'Book a desert safari in Qatar — Sealine dune trips, full-day adventures and overnight desert camps with dinner, dune bashing and stargazing. Compare packages from trusted local operators and reserve your spot on AL Jadwal.',
        metaTitle: 'Desert Safari Qatar | Dune Adventures & Prices',
        metaDescription:
          'Experience the thrill of Qatar\'s golden dunes. Compare overnight desert safari Qatar prices and enjoy dune bashing, camel rides and more with AL Jadwal.',
      },
      ar: {
        h1: 'سفاري الصحراء والتخييم في قطر',
        intro:
          'احجز رحلة سفاري في صحراء قطر — رحلات الكثبان في سيلين، مغامرات اليوم الكامل ومخيمات المبيت مع العشاء وتطعيس الكثبان ومراقبة النجوم. قارن الباقات من مشغّلين موثوقين عبر AL Jadwal.',
        metaTitle: 'سفاري الصحراء في قطر — رحلات سيلين ومخيمات المبيت',
        metaDescription:
          'احجز سفاري الصحراء في قطر: رحلات سيلين، مخيمات يوم كامل ومبيت مع العشاء. قارن الأسعار والتقييمات عبر AL Jadwal.',
      },
    },
  },
  {
    slug: 'water-activities-qatar',
    cluster: 'water',
    filter: { category: 'water-activities' },
    launched: true,
    priority: 0.8,
    related: ['yacht-rental-qatar', 'doha-boat-tour', 'desert-safari-qatar'],
    keyword: 'Water Activities Qatar',
    keywordAr: 'الأنشطة المائية في قطر',
    copy: {
      en: {
        h1: 'Water Sports & Boat Trips in Qatar',
        intro:
          'Yachts, speedboats, traditional dhows, jet boats and water-sports trips across Doha, The Pearl and the Qatari coast. Compare on-water experiences from trusted operators, see real prices and book in minutes on AL Jadwal.',
        metaTitle: 'Water Sports & Boat Trips in Qatar — Yachts, Dhows, Jet Boats',
        metaDescription:
          'Book water sports and boat trips in Qatar — yachts, speedboats, dhow cruises and jet-boat rides in Doha & The Pearl. Real prices and reviews on AL Jadwal.',
      },
      ar: {
        h1: 'الرياضات المائية ورحلات القوارب في قطر',
        intro:
          'يخوت وقوارب سريعة ومراكب داو تقليدية ورحلات رياضات مائية في الدوحة واللؤلؤة وسواحل قطر. قارن التجارب البحرية من مشغّلين موثوقين واحجز خلال دقائق عبر AL Jadwal.',
        metaTitle: 'الرياضات المائية ورحلات القوارب في قطر',
        metaDescription:
          'احجز الرياضات المائية ورحلات القوارب في قطر — يخوت وقوارب سريعة ومراكب داو في الدوحة واللؤلؤة. أسعار وتقييمات حقيقية عبر AL Jadwal.',
      },
    },
  },
  {
    slug: 'resorts-chalets-qatar',
    cluster: 'stays',
    filter: { category: 'resorts-more-' },
    launched: true,
    priority: 0.8,
    related: ['caravan-rental-qatar', 'desert-safari-qatar'],
    keyword: 'Resorts & Chalets Qatar',
    keywordAr: 'منتجعات وشاليهات قطر',
    copy: {
      en: {
        h1: 'Resorts, Chalets & Caravans in Qatar',
        intro:
          'Day-use resorts, private chalets, beach villas and luxury caravans across Qatar — from Doha to Al Shahaniya and the north coast. Book your day-out or overnight stay with trusted hosts and see real prices on AL Jadwal.',
        metaTitle: 'Resorts & Chalets for Rent in Qatar',
        metaDescription:
          'Explore resorts rental Qatar options for family getaways, private stays and relaxing escapes. Browse resorts and chalets and book with AL Jadwal.',
      },
      ar: {
        h1: 'منتجعات وشاليهات وكرفانات في قطر',
        intro:
          'منتجعات لليوم الواحد وشاليهات خاصة وفلل شاطئية وكرفانات فاخرة في قطر — من الدوحة إلى الشحانية وشمال البلاد. احجز يومك أو إقامتك مع مضيفين موثوقين عبر AL Jadwal.',
        metaTitle: 'منتجعات وشاليهات وكرفانات في قطر',
        metaDescription:
          'احجز المنتجعات والشاليهات والفلل والكرفانات في قطر لقضاء اليوم أو المبيت. قارن المواقع والأسعار والتقييمات عبر AL Jadwal.',
      },
    },
  },
  {
    slug: 'yacht-rental-qatar',
    cluster: 'water',
    filter: { search: 'yacht' },
    launched: true,
    priority: 0.7,
    related: ['doha-boat-tour', 'water-activities-qatar'],
    keyword: 'Yacht Rental Qatar',
    keywordAr: 'تأجير يخت في قطر',
    copy: {
      en: {
        h1: 'Yacht Rental in Qatar',
        intro:
          'Charter a private yacht in Doha and The Pearl — sunset cruises, celebrations and day trips on the Arabian Gulf. Compare yachts by capacity and price from trusted Qatar operators and book securely on AL Jadwal.',
        metaTitle: 'Yacht Rental Qatar | Hire Premium Charters',
        metaDescription:
          'Hire a luxury yacht in Qatar with AL Jadwal. Sunset cruises, corporate events and weekend escapes on the Gulf. Instant confirmation — book today!',
      },
      ar: {
        h1: 'تأجير يخت في قطر',
        intro:
          'استأجر يختاً خاصاً في الدوحة واللؤلؤة — رحلات الغروب والمناسبات ورحلات اليوم في الخليج العربي. قارن اليخوت حسب السعة والسعر من مشغّلين موثوقين واحجز بأمان عبر AL Jadwal.',
        metaTitle: 'تأجير يخت في قطر — رحلات يخت خاصة في الدوحة واللؤلؤة',
        metaDescription:
          'استأجر يختاً خاصاً في قطر — رحلات غروب ورحلات يومية في الدوحة واللؤلؤة. قارن اليخوت والسعة والأسعار والتقييمات عبر AL Jadwal.',
      },
    },
  },
  {
    slug: 'caravan-rental-qatar',
    cluster: 'stays',
    filter: { search: 'caravan' },
    launched: true,
    priority: 0.7,
    related: ['resorts-chalets-qatar', 'desert-safari-qatar'],
    keyword: 'Caravan Rental Qatar',
    keywordAr: 'تأجير كرفان في قطر',
    copy: {
      en: {
        h1: 'Caravan Rental in Qatar',
        intro:
          'VIP and family caravans for desert getaways and weekend escapes across Qatar — fully equipped, air-conditioned and ready to book. Compare caravans by location, capacity and price on AL Jadwal.',
        metaTitle: 'Caravan Rental Qatar | Desert Glamping Getaways',
        metaDescription:
          'Rent a cozy caravan in Qatar and explore the desert in style. Perfect for families and couples seeking a unique glamping adventure. Affordable rates!',
      },
      ar: {
        h1: 'تأجير كرفان في قطر',
        intro:
          'كرفانات VIP وعائلية للعطلات الصحراوية ونهايات الأسبوع في قطر — مجهّزة بالكامل ومكيّفة وجاهزة للحجز. قارن الكرفانات حسب الموقع والسعة والسعر عبر AL Jadwal.',
        metaTitle: 'تأجير كرفان في قطر — كرفانات صحراوية VIP وعائلية',
        metaDescription:
          'استأجر كرفاناً في قطر — كرفانات صحراوية VIP وعائلية مجهّزة بالكامل ومكيّفة. قارن المواقع والأسعار والتقييمات عبر AL Jadwal.',
      },
    },
  },
  {
    slug: 'doha-boat-tour',
    cluster: 'water',
    filter: { search: 'boat' },
    launched: true,
    priority: 0.7,
    related: ['yacht-rental-qatar', 'water-activities-qatar'],
    keyword: 'Doha Boat Tour',
    keywordAr: 'جولة قارب في الدوحة',
    copy: {
      en: {
        h1: 'Boat Tours in Doha',
        intro:
          'Explore Doha from the water — Corniche cruises, Pearl boat tours, traditional dhows and speedboat rides. Compare boat trips by duration and price from trusted operators and book online on AL Jadwal.',
        metaTitle: 'Doha Boat Tour | Scenic Skyline Cruises',
        metaDescription:
          'See Doha\'s stunning skyline from the water with AL Jadwal\'s guided boat tours. Pass West Bay, Katara and The Pearl. Book your seat today!',
      },
      ar: {
        h1: 'جولات القوارب في الدوحة',
        intro:
          'اكتشف الدوحة من البحر — رحلات الكورنيش وجولات قوارب اللؤلؤة ومراكب الداو التقليدية والقوارب السريعة. قارن رحلات القوارب حسب المدة والسعر واحجز عبر AL Jadwal.',
        metaTitle: 'جولات القوارب في الدوحة — رحلات الكورنيش والداو',
        metaDescription:
          'احجز جولة قارب في الدوحة — رحلات الكورنيش واللؤلؤة ومراكب الداو والقوارب السريعة. قارن المدد والأسعار والتقييمات عبر AL Jadwal.',
      },
    },
  },

  // ───────────── DORMANT (built but noindex + not in sitemap) — flip `launched` when inventory grows ─────────────
  { slug: 'yacht-cruise-doha', cluster: 'water', filter: { search: 'yacht' }, launched: false, priority: 0.6, related: ['yacht-rental-qatar'], keyword: 'Yacht Cruise Doha', keywordAr: 'رحلة يخت في الدوحة' },
  { slug: 'private-yacht-doha', cluster: 'water', filter: { search: 'yacht' }, launched: false, priority: 0.6, related: ['yacht-rental-qatar'], keyword: 'Private Yacht Doha', keywordAr: 'يخت خاص في الدوحة' },
  { slug: 'dhow-cruise-doha', cluster: 'water', filter: { search: 'dhow' }, launched: false, priority: 0.6, related: ['doha-boat-tour'], keyword: 'Dhow Cruise Doha', keywordAr: 'رحلة داو في الدوحة' },
  { slug: 'the-pearl-boat-tour', cluster: 'water', filter: { search: 'boat' }, launched: false, priority: 0.6, related: ['doha-boat-tour'], keyword: 'The Pearl Boat Tour', keywordAr: 'جولة قارب في اللؤلؤة' },
  { slug: 'jet-ski-qatar', cluster: 'water', filter: { search: 'jet' }, launched: false, priority: 0.6, related: ['water-activities-qatar'], keyword: 'Jet Ski Qatar', keywordAr: 'جت سكي في قطر' },
  { slug: 'watersports-doha', cluster: 'water', filter: { search: 'water sport' }, launched: false, priority: 0.6, related: ['water-activities-qatar'], keyword: 'Watersports Doha', keywordAr: 'الرياضات المائية في الدوحة' },
  { slug: 'fishing-trip-qatar', cluster: 'fishing', filter: { search: 'fishing' }, launched: false, priority: 0.6, related: ['water-activities-qatar'], keyword: 'Fishing Trip Qatar', keywordAr: 'رحلة صيد في قطر' },
  { slug: 'deep-sea-fishing-doha', cluster: 'fishing', filter: { search: 'fishing' }, launched: false, priority: 0.6, related: ['water-activities-qatar'], keyword: 'Deep Sea Fishing Doha', keywordAr: 'صيد أعماق البحر في الدوحة' },
  { slug: 'sealine-desert-camping', cluster: 'desert', filter: { search: 'camp' }, launched: false, priority: 0.6, related: ['desert-safari-qatar'], keyword: 'Sealine Desert Camping', keywordAr: 'تخييم سيلين الصحراوي' },
  { slug: 'overnight-desert-safari-doha', cluster: 'desert', filter: { search: 'overnight' }, launched: false, priority: 0.6, related: ['desert-safari-qatar'], keyword: 'Overnight Desert Safari Doha', keywordAr: 'سفاري صحراء ليلي في الدوحة' },
  { slug: 'overnight-sealine-safari-fireworks', cluster: 'desert', filter: { search: 'overnight' }, launched: false, priority: 0.5, related: ['desert-safari-qatar'], keyword: 'Overnight Sealine Safari with Fireworks', keywordAr: 'سفاري سيلين ليلي مع الألعاب النارية' },
  { slug: 'desert-safari-qatar-price', cluster: 'desert', filter: { category: 'leisure-fun' }, launched: false, priority: 0.5, related: ['desert-safari-qatar'], keyword: 'Desert Safari Qatar Price', keywordAr: 'سعر سفاري الصحراء في قطر' },
  { slug: 'holiday-apartments-qatar', cluster: 'stays', filter: { search: 'apartment' }, launched: false, priority: 0.6, related: ['resorts-chalets-qatar'], keyword: 'Holiday Apartments Qatar', keywordAr: 'شقق عطلات في قطر' },
  { slug: 'short-stay-apartments-the-pearl', cluster: 'stays', filter: { search: 'apartment' }, launched: false, priority: 0.5, related: ['resorts-chalets-qatar'], keyword: 'Short Stay Apartments The Pearl', keywordAr: 'شقق إقامة قصيرة في اللؤلؤة' },
  { slug: 'water-city-tour-doha-corniche', cluster: 'tours', filter: { search: 'city tour' }, launched: false, priority: 0.5, related: ['desert-safari-qatar', 'doha-boat-tour'], keyword: 'Doha Corniche City Tour', keywordAr: 'جولة كورنيش الدوحة' },
  // Seasonal — keep dormant until the season; flip on ~6 weeks before.
  { slug: 'iftar-sealine-desert-camp', cluster: 'seasonal', filter: { search: 'camp' }, launched: false, priority: 0.5, related: ['desert-safari-qatar'], keyword: 'Iftar at Sealine Desert Camp', keywordAr: 'إفطار في مخيم سيلين الصحراوي' },
  { slug: 'nye-dhow-cruise-doha', cluster: 'seasonal', filter: { search: 'dhow' }, launched: false, priority: 0.5, related: ['doha-boat-tour'], keyword: 'New Year Dhow Cruise Doha', keywordAr: 'رحلة داو رأس السنة في الدوحة' },
];

const BY_SLUG: Record<string, SeoLanding> = Object.fromEntries(SEO_LANDINGS.map((l) => [l.slug, l]));

export function getLanding(slug: string): SeoLanding | undefined {
  return BY_SLUG[slug];
}

export function allLandingSlugs(): string[] {
  return SEO_LANDINGS.map((l) => l.slug);
}

export function launchedLandings(): SeoLanding[] {
  return SEO_LANDINGS.filter((l) => l.launched);
}

/** Templated fallback copy for dormant pages (noindex, so near-duplicate copy is harmless). */
function templatedCopy(l: SeoLanding, lang: LandingLang): LandingCopy {
  const kw = lang === 'ar' ? l.keywordAr : l.keyword;
  return lang === 'ar'
    ? {
        h1: kw,
        intro: `استكشف ${kw} في قطر واحجز من مشغّلين موثوقين عبر AL Jadwal.`,
        metaTitle: kw,
        metaDescription: `احجز ${kw} في قطر مع AL Jadwal. قارن الخيارات والأسعار والتقييمات.`,
      }
    : {
        h1: kw,
        intro: `Explore ${kw} in Qatar and book trusted local operators on AL Jadwal.`,
        metaTitle: kw,
        metaDescription: `Book ${kw} in Qatar with AL Jadwal. Compare options, real prices and reviews.`,
      };
}

/** Resolve a landing page's copy for a language (full override or templated fallback). */
export function landingCopy(l: SeoLanding, lang: LandingLang): LandingCopy {
  return l.copy?.[lang] ?? templatedCopy(l, lang);
}
