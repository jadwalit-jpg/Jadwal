/**
 * SEO guide / pillar-content registry (Tier-2 of the keyword map).
 *
 * These are informational "things to do" guides that capture tourists in the
 * RESEARCH phase, then funnel them DOWN to the bookable Phase-A landing pages
 * (lib/seo-landings.ts) and activity pages via internal links — the classic
 * pillar → money-page structure.
 *
 * Data-driven + in-repo (no DB model, no MDX tooling): one server-rendered
 * `app/blog/[slug]` route renders every published guide. `published: false`
 * guides are dormant (noindex, not in the blog index or sitemap) until their
 * copy is finalised. Bilingual via the cookie i18n; only EN URLs indexed for
 * now (per-language /ar/ URLs = deferred P1#4).
 */

import type { LandingLang } from '@/lib/seo-landings';

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface GuideSection {
  heading: LocalizedText;
  /** Paragraphs (rendered as <p>). */
  body: LocalizedText[];
}

export interface SeoGuide {
  slug: string;
  /** Indexed + in the blog index + sitemap only when true. */
  published: boolean;
  priority: number;
  /** Static "last updated" date (YYYY-MM-DD) for Article schema + sitemap. */
  updated: string;
  title: LocalizedText;
  /** Meta description (120–160 chars EN). */
  description: LocalizedText;
  intro: LocalizedText;
  sections: GuideSection[];
  /** Phase-A landing slugs to link down to (the booking funnel). */
  relatedLandings: string[];
}

export const SEO_GUIDES: SeoGuide[] = [
  {
    slug: 'things-to-do-in-qatar',
    published: true,
    priority: 0.7,
    updated: '2026-06-17',
    title: {
      en: 'Things to Do in Qatar: The Complete Guide',
      ar: 'أشياء يمكنك القيام بها في قطر: الدليل الكامل',
    },
    description: {
      en: 'From desert safaris and yacht cruises to resorts and dhow trips — the complete guide to the best things to do in Qatar, with prices and how to book.',
      ar: 'من سفاري الصحراء ورحلات اليخوت إلى المنتجعات ورحلات الداو — الدليل الكامل لأفضل الأنشطة في قطر مع الأسعار وطريقة الحجز.',
    },
    intro: {
      en: 'Qatar packs a remarkable range of experiences into a small country — golden dunes that meet the sea at Khor Al Adaid, a glittering Doha skyline best seen from the water, and weekend resorts an hour from the city. This guide rounds up the experiences worth your time and links you straight to bookable options.',
      ar: 'تقدّم قطر مجموعة رائعة من التجارب في بلد صغير — كثبان ذهبية تلتقي بالبحر في خور العديد، وأفق الدوحة المتلألئ الذي يُرى أفضل ما يكون من البحر، ومنتجعات نهاية الأسبوع على بُعد ساعة من المدينة. يجمع هذا الدليل التجارب التي تستحق وقتك ويربطك مباشرة بخيارات قابلة للحجز.',
    },
    sections: [
      {
        heading: { en: 'Desert safari & overnight camps', ar: 'سفاري الصحراء ومخيمات المبيت' },
        body: [
          {
            en: 'No trip to Qatar is complete without a desert safari to the Inland Sea (Khor Al Adaid). Day trips include dune bashing, camel rides and a camp lunch; overnight packages add dinner, a bonfire and stargazing far from the city lights. Sealine is the launch point for most operators.',
            ar: 'لا تكتمل أي رحلة إلى قطر دون سفاري صحراوي إلى البحر الداخلي (خور العديد). تشمل رحلات اليوم الواحد تطعيس الكثبان وركوب الجمال وغداءً في المخيم؛ بينما تضيف باقات المبيت العشاء ونار المخيم ومراقبة النجوم بعيداً عن أضواء المدينة. وتُعدّ سيلين نقطة انطلاق معظم المشغّلين.',
          },
        ],
      },
      {
        heading: { en: 'On the water — yachts, boats & dhows', ar: 'على الماء — يخوت وقوارب ومراكب داو' },
        body: [
          {
            en: 'Doha is best seen from the Gulf. Charter a private yacht for a sunset cruise around The Pearl, take a traditional dhow along the Corniche, or hop on a speedboat for a faster ride. Most trips run hourly and are easy to combine with a waterfront dinner.',
            ar: 'تُرى الدوحة أفضل ما يكون من الخليج. استأجر يختاً خاصاً لرحلة غروب حول اللؤلؤة، أو اركب مركب داو تقليدياً على طول الكورنيش، أو استقلّ قارباً سريعاً لجولة أسرع. تعمل معظم الرحلات بالساعة ويسهل دمجها مع عشاء على الواجهة البحرية.',
          },
        ],
      },
      {
        heading: { en: 'Resorts, chalets & caravans', ar: 'منتجعات وشاليهات وكرفانات' },
        body: [
          {
            en: 'For a weekend escape, Qatar has day-use resorts, private beach chalets and fully-equipped desert caravans — many in Al Shahaniya and along the north coast. They are ideal for families and groups who want a private base rather than a hotel.',
            ar: 'لقضاء عطلة نهاية الأسبوع، توفّر قطر منتجعات لليوم الواحد وشاليهات شاطئية خاصة وكرفانات صحراوية مجهّزة بالكامل — كثير منها في الشحانية وعلى طول الساحل الشمالي. وهي مثالية للعائلات والمجموعات التي تفضّل قاعدة خاصة بدلاً من الفندق.',
          },
        ],
      },
    ],
    relatedLandings: ['desert-safari-qatar', 'water-activities-qatar', 'resorts-chalets-qatar'],
  },
  {
    slug: '2-days-in-doha-itinerary',
    published: true,
    priority: 0.6,
    updated: '2026-06-17',
    title: {
      en: '2 Days in Doha: The Perfect Itinerary',
      ar: 'يومان في الدوحة: خطة الرحلة المثالية',
    },
    description: {
      en: 'A 48-hour Doha itinerary: Corniche and a boat tour on day one, a desert safari on day two — with bookable activities and where to stay.',
      ar: 'خطة رحلة 48 ساعة في الدوحة: الكورنيش وجولة بحرية في اليوم الأول، وسفاري صحراوي في اليوم الثاني — مع أنشطة قابلة للحجز وأماكن للإقامة.',
    },
    intro: {
      en: 'Short on time? Two days is enough to see the best of Doha and still get a taste of the desert. Here is a simple, bookable itinerary that balances the city, the water and the dunes.',
      ar: 'وقتك ضيق؟ يومان كافيان لرؤية أفضل ما في الدوحة مع الاستمتاع بطعم الصحراء. إليك خطة رحلة بسيطة وقابلة للحجز توازن بين المدينة والبحر والكثبان.',
    },
    sections: [
      {
        heading: { en: 'Day 1 — Corniche & the water', ar: 'اليوم الأول — الكورنيش والبحر' },
        body: [
          {
            en: 'Start along the Doha Corniche, then head onto the Gulf: a dhow cruise or a private yacht charter is the best way to see the skyline and The Pearl. Aim for late afternoon so you catch the sunset on the water.',
            ar: 'ابدأ على طول كورنيش الدوحة، ثم توجّه إلى الخليج: تُعدّ رحلة الداو أو استئجار يخت خاص أفضل طريقة لرؤية الأفق واللؤلؤة. اجعل موعدك بعد الظهر لتلحق بغروب الشمس على الماء.',
          },
        ],
      },
      {
        heading: { en: 'Day 2 — Desert safari', ar: 'اليوم الثاني — سفاري الصحراء' },
        body: [
          {
            en: 'Spend day two in the desert. A full-day Sealine safari covers dune bashing and the Inland Sea; if you can, upgrade to an overnight camp for dinner and stargazing before heading back to the city.',
            ar: 'اقضِ اليوم الثاني في الصحراء. تغطّي رحلة سيلين ليوم كامل تطعيس الكثبان والبحر الداخلي؛ وإن استطعت، فارتقِ إلى مخيم مبيت لتناول العشاء ومراقبة النجوم قبل العودة إلى المدينة.',
          },
        ],
      },
      {
        heading: { en: 'Where to stay', ar: 'أين تقيم' },
        body: [
          {
            en: 'Base yourself in the city for easy access to both days, or book a resort or chalet outside Doha if you prefer a quieter, private weekend.',
            ar: 'اتّخذ من المدينة قاعدة لك لسهولة الوصول في كلا اليومين، أو احجز منتجعاً أو شاليهاً خارج الدوحة إن كنت تفضّل عطلة نهاية أسبوع أهدأ وأكثر خصوصية.',
          },
        ],
      },
    ],
    relatedLandings: ['doha-boat-tour', 'desert-safari-qatar', 'resorts-chalets-qatar'],
  },
  {
    slug: 'best-time-for-desert-safari-qatar',
    published: true,
    priority: 0.6,
    updated: '2026-06-17',
    title: {
      en: 'Best Time for a Desert Safari in Qatar',
      ar: 'أفضل وقت لرحلة سفاري في صحراء قطر',
    },
    description: {
      en: 'When to book a desert safari in Qatar: the best months, what to expect by season, and day-trip vs overnight camping — plus how to book.',
      ar: 'متى تحجز سفاري الصحراء في قطر: أفضل الأشهر، وما تتوقعه حسب الموسم، ورحلة اليوم مقابل المبيت — وكيفية الحجز.',
    },
    intro: {
      en: 'A desert safari is a year-round experience in Qatar, but the season changes everything — from the temperature on the dunes to whether an overnight camp is comfortable. Here is how to pick the right time.',
      ar: 'سفاري الصحراء تجربة متاحة طوال العام في قطر، لكن الموسم يغيّر كل شيء — من درجة الحرارة على الكثبان إلى مدى راحة المبيت في المخيم. إليك كيف تختار الوقت المناسب.',
    },
    sections: [
      {
        heading: { en: 'The best months: November to March', ar: 'أفضل الأشهر: من نوفمبر إلى مارس' },
        body: [
          {
            en: 'The cool season (November–March) is the sweet spot: mild days, cold desert nights perfect for a bonfire, and the most comfortable conditions for dune bashing and camping. This is peak season, so book popular overnight camps ahead.',
            ar: 'الموسم البارد (نوفمبر–مارس) هو الأمثل: أيام معتدلة وليالٍ صحراوية باردة مثالية لنار المخيم، وأكثر الظروف راحة لتطعيس الكثبان والتخييم. هذا هو موسم الذروة، لذا احجز مخيمات المبيت الشهيرة مسبقاً.',
          },
        ],
      },
      {
        heading: { en: 'Summer safaris (June–September)', ar: 'سفاري الصيف (يونيو–سبتمبر)' },
        body: [
          {
            en: 'Summer is hot, so go early morning or late afternoon, keep day trips short, and prioritise the Inland Sea where a swim cools things down. Overnight camps are still pleasant once the sun sets.',
            ar: 'الصيف حار، لذا اذهب في الصباح الباكر أو بعد الظهر، واجعل رحلات اليوم قصيرة، وأعطِ الأولوية للبحر الداخلي حيث تلطّف السباحة الأجواء. وتبقى مخيمات المبيت لطيفة بعد غروب الشمس.',
          },
        ],
      },
      {
        heading: { en: 'Day trip or overnight?', ar: 'رحلة يوم أم مبيت؟' },
        body: [
          {
            en: 'A full-day trip is enough for dune bashing and the Inland Sea. Choose an overnight camp if you want dinner, a bonfire and stargazing — the desert sky is the real reward, and it is at its best in the cool season.',
            ar: 'رحلة اليوم الكامل تكفي لتطعيس الكثبان والبحر الداخلي. اختر مخيم المبيت إن أردت العشاء ونار المخيم ومراقبة النجوم — فسماء الصحراء هي المكافأة الحقيقية، وهي في أفضل حالاتها في الموسم البارد.',
          },
        ],
      },
    ],
    relatedLandings: ['desert-safari-qatar', 'caravan-rental-qatar'],
  },
];

const BY_SLUG: Record<string, SeoGuide> = Object.fromEntries(SEO_GUIDES.map((g) => [g.slug, g]));

export function getGuide(slug: string): SeoGuide | undefined {
  return BY_SLUG[slug];
}

export function allGuideSlugs(): string[] {
  return SEO_GUIDES.map((g) => g.slug);
}

export function publishedGuides(): SeoGuide[] {
  return SEO_GUIDES.filter((g) => g.published);
}

export function tr(text: LocalizedText, lang: LandingLang): string {
  return text[lang] ?? text.en;
}
