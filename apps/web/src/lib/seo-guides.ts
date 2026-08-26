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
 * copy is finalised. Bilingual via the cookie i18n.
 *
 * ── EDITORIAL RULES (2026-08-26 rewrite) ────────────────────────────────────
 * Every price, duration and capacity below is the LIVE catalogue value at the
 * time of writing, and every activity named is a real listing. Two consequences:
 *
 *   1. Prices DRIFT. Re-check against /api/catalog/activities before each
 *      yearly refresh. A guide quoting a stale price reads worse than one
 *      quoting none, because it fails the one visitor who checks.
 *   2. Do NOT invent specifics. Durations, capacities and suitability claims
 *      appear only where the catalogue actually carries them. Where a fact was
 *      unavailable the copy stays deliberately general rather than guessing —
 *      open questions live in JADWAL_GUIDE_CONTENT_GAPS.md on the owner's
 *      desktop (this repo gitignores *.md).
 *
 * Pricing gotcha worth keeping in mind when editing: 48 of the 50 live
 * activities are `PER_UNIT` (the price buys the whole boat/chalet, whatever the
 * headcount). Only `Public Al Safliya Island Water Sports` and
 * `Full-Day Desert Safari Qatar` are `PER_PERSON`. The copy leans on that,
 * because per-head maths is what makes a QAR 2,000 dhow look affordable.
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
    updated: '2026-08-26',
    title: {
      en: 'Things to Do in Qatar in 2026: The Complete Guide',
      ar: 'أشياء يمكنك القيام بها في قطر 2026: الدليل الكامل',
    },
    description: {
      en: 'Desert safaris from QAR 150, yacht charters, kayaking, resorts and caravans — every worthwhile thing to do in Qatar, with real prices and how to book.',
      ar: 'سفاري صحراوي من 150 ر.ق، ورحلات يخوت، وتجديف، ومنتجعات وكرفانات — كل ما يستحق القيام به في قطر مع الأسعار الحقيقية وطريقة الحجز.',
    },
    intro: {
      en: 'Qatar packs a remarkable range into a small country. You can be dune bashing at the Inland Sea in the morning and watching the Doha skyline from a boat the same evening. This guide covers what is actually worth your time, what each thing costs in Qatari riyals, and when to come — every activity mentioned is bookable, and the prices are the real ones.',
      ar: 'تجمع قطر تنوعاً هائلاً في بلد صغير. يمكنك تطعيس الكثبان عند البحر الداخلي صباحاً ومشاهدة أفق الدوحة من قارب في المساء نفسه. يغطي هذا الدليل ما يستحق وقتك فعلاً، وكم يكلّف كل نشاط بالريال القطري، ومتى تأتي — كل نشاط مذكور قابل للحجز، والأسعار حقيقية.',
    },
    sections: [
      {
        heading: { en: 'On the water — the thing Qatar does best', ar: 'على الماء — ما تتميّز به قطر' },
        body: [
          {
            en: 'Doha looks its best from the Gulf, and the water is where the widest range of options sits. Entry level is genuinely cheap: a Kayak Ride starts at QAR 100 for an hour, a single kayak at QAR 180 and a double at QAR 280 — enough time on flat water to see the skyline without committing to a whole afternoon.',
            ar: 'تبدو الدوحة في أبهى صورها من الخليج، والماء هو المكان الذي يضم أوسع مجموعة من الخيارات. المستوى المبدئي رخيص فعلاً: تبدأ جولة الكاياك من 100 ر.ق لمدة ساعة، والكاياك الفردي من 180 ر.ق، والمزدوج من 280 ر.ق — وقت يكفي على مياه هادئة لرؤية الأفق دون الالتزام بفترة بعد ظهر كاملة.',
          },
          {
            en: 'Speedboats are the popular middle ground, and because the price buys the whole boat they get better value the more of you there are: QAR 350 for up to four, QAR 450 for five, QAR 600 for eight, and the Q Speed Boat at QAR 800 for ten — about QAR 80 a head. If you want the adrenaline version instead, a Wakeboard session is QAR 550, a Banana Ride QAR 600, and Fly Board with Supercharge Jetski QAR 1,000.',
            ar: 'القوارب السريعة هي الخيار الأوسط الأكثر شعبية، ولأن السعر يشمل القارب كاملاً فإن قيمتها تتحسّن كلما زاد عددكم: 350 ر.ق حتى أربعة أشخاص، و450 ر.ق لخمسة، و600 ر.ق لثمانية، وقارب Q السريع بـ800 ر.ق لعشرة — أي نحو 80 ر.ق للفرد. وإذا أردت النسخة المليئة بالأدرينالين، فجلسة التزلج على الماء بـ550 ر.ق، وركوب الموزة بـ600 ر.ق، والفلاي بورد مع الجيت سكي بـ1,000 ر.ق.',
          },
          {
            en: 'At the top end are private charters. Yachts run from QAR 1,200 for the C-Ray up to QAR 1,600 for the Q Luxury Yacht, with a Catamaran at QAR 1,800 for four hours. For a full day with a group, houseboats go from QAR 3,000 — and a Traditional Dhow, the wooden boat Qatar built its pearling trade on, is QAR 2,000 and takes up to 105 people. Most of these boats are listed at Box Park.',
            ar: 'في الفئة الأعلى تأتي الرحلات الخاصة. تبدأ اليخوت من 1,200 ر.ق ليخت C-Ray وحتى 1,600 ر.ق لليخت الفاخر Q، مع كاتاماران بـ1,800 ر.ق لأربع ساعات. ولقضاء يوم كامل مع مجموعة، تبدأ البيوت العائمة من 3,000 ر.ق — أما مركب الداو التقليدي، القارب الخشبي الذي بنت عليه قطر تجارة اللؤلؤ، فبـ2,000 ر.ق ويتّسع حتى 105 أشخاص. ومعظم هذه القوارب مُدرجة في بوكس بارك.',
          },
          {
            en: 'Fishing is its own category: Balhambar and Marlin both run four-hour boat fishing trips at QAR 1,500. And Public Al Safliya Island Water Sports at QAR 125 is a four-hour trip out to the island — priced per person rather than per boat, and the cheapest way to combine a crossing with time actually in the water.',
            ar: 'الصيد فئة قائمة بذاتها: يوفّر كل من بالحمبار ومارلين رحلات صيد بالقارب من أربع ساعات بـ1,500 ر.ق. أما الرياضات المائية العامة في جزيرة الصفلية بـ125 ر.ق فهي رحلة من أربع ساعات إلى الجزيرة — ويُحسب سعرها للشخص لا للقارب، وهي أرخص طريقة للجمع بين العبور والوقت الفعلي في الماء.',
          },
        ],
      },
      {
        heading: { en: 'Desert safari and the Inland Sea', ar: 'سفاري الصحراء والبحر الداخلي' },
        body: [
          {
            en: 'The Inland Sea (Khor Al Adaid) is the one landscape Qatar has that almost nowhere else does — open desert running straight into a tidal seawater inlet, about an hour south of Doha. It is a UNESCO-recognised natural reserve, and reaching it means driving over dunes, which is why every operator runs 4x4s rather than coaches.',
            ar: 'البحر الداخلي (خور العديد) هو المشهد الطبيعي الوحيد الذي تملكه قطر ولا يكاد يوجد في مكان آخر — صحراء مفتوحة تصبّ مباشرة في خليج بحري تتحكّم فيه المدّ والجزر، على بُعد ساعة جنوب الدوحة. وهو محمية طبيعية معترف بها من اليونسكو، والوصول إليه يتطلب القيادة فوق الكثبان، ولهذا يستخدم كل المشغّلين سيارات الدفع الرباعي بدل الحافلات.',
          },
          {
            en: 'A Full-Day Desert Safari starts at QAR 150 per person, which is the best-value single activity in the whole catalogue. Longer options run deeper into the day: an eight-hour Safari trip is QAR 1,700 and a full-day nineteen-hour version QAR 1,800.',
            ar: 'يبدأ سفاري الصحراء ليوم كامل من 150 ر.ق للشخص، وهو أفضل نشاط منفرد من حيث القيمة في الكتالوج كله. وتمتد الخيارات الأطول أعمق في اليوم: رحلة سفاري من ثماني ساعات بـ1,700 ر.ق، ونسخة اليوم الكامل من تسع عشرة ساعة بـ1,800 ر.ق.',
          },
          {
            en: 'Staying the night is a different experience altogether. An Overnight Desert Safari at the Sealine Camp is QAR 500, and Al Rehlah Camp QAR 1,500. The reason to do it is the sky: Sealine is far enough from Doha that the light pollution drops away, which you will not get on a day trip.',
            ar: 'المبيت تجربة مختلفة تماماً. سفاري صحراوي مع مبيت في مخيم سيلين بـ500 ر.ق، ومخيم الرحلة بـ1,500 ر.ق. والسبب الحقيقي للمبيت هو السماء: سيلين بعيدة بما يكفي عن الدوحة ليختفي التلوّث الضوئي، وهو ما لن تحصل عليه في رحلة نهارية.',
          },
        ],
      },
      {
        heading: { en: 'Weekend stays — resorts, chalets and caravans', ar: 'إقامات نهاية الأسبوع — منتجعات وشاليهات وكرفانات' },
        body: [
          {
            en: 'Renting a private place for the weekend is a normal thing to do in Qatar in a way it is not in most countries, and the range is wide. The cheapest entry is a Lusail Apartment at QAR 800. Caravans — fully-equipped units parked in the desert or near the coast — start at QAR 1,050 for the Al Marona VIP, QAR 1,200 for the VVIP, and QAR 1,500 for either Al Khor Caravan cabin.',
            ar: 'استئجار مكان خاص لعطلة نهاية الأسبوع أمر معتاد في قطر بشكل لا نجده في معظم الدول، والخيارات واسعة. أرخص بداية شقة في لوسيل بـ800 ر.ق. أما الكرفانات — وحدات مجهّزة بالكامل تقف في الصحراء أو قرب الساحل — فتبدأ من 1,050 ر.ق لكرفان المارونة VIP، و1,200 ر.ق لفئة VVIP، و1,500 ر.ق لأي من كابينتي كرفان الخور.',
          },
          {
            en: 'For a full resort or chalet, Cavilam Resort is QAR 1,200, Ghatha Resort QAR 1,500, and at the top Stone Chalet and North Villa at QAR 2,500, with Al Kadi Resort and J Rest Private Chalet at QAR 2,600. These suit groups and families who want a private base with a kitchen rather than a hotel room — which is most of the reason people book them.',
            ar: 'أما المنتجعات والشاليهات الكاملة، فمنتجع كافيلام بـ1,200 ر.ق، ومنتجع غاثة بـ1,500 ر.ق، وفي الأعلى شاليه ستون وفيلا الشمال بـ2,500 ر.ق، ومنتجع الكادي وشاليه J Rest الخاص بـ2,600 ر.ق. وتناسب هذه المجموعات والعائلات التي تريد قاعدة خاصة بمطبخ بدلاً من غرفة فندقية — وهو السبب الأهم وراء حجزها.',
          },
        ],
      },
      {
        heading: { en: 'City, culture and the north', ar: 'المدينة والثقافة والشمال' },
        body: [
          {
            en: 'Doha itself rewards a proper tour. A Grand Doha City Tour is QAR 800 and a Private City Tour QAR 1,000 — both cover the landmarks you would otherwise spend a day working out how to reach: the Corniche, Souq Waqif, Katara Cultural Village, Msheireb and The Pearl.',
            ar: 'تستحق الدوحة نفسها جولة حقيقية. جولة الدوحة الكبرى بـ800 ر.ق والجولة الخاصة بـ1,000 ر.ق — وتغطيان المعالم التي ستقضي يوماً كاملاً في محاولة الوصول إليها بنفسك: الكورنيش، وسوق واقف، والحي الثقافي كتارا، ومشيرب، واللؤلؤة.',
          },
          {
            en: 'If you have already seen Doha, the North of Qatar Historical Tour at QAR 1,100 goes to the part of the country most visitors never reach — the abandoned village of Al Jumail, the Al Zubarah fort, and the mangroves at Al Thakira, which are the calmest water in the country.',
            ar: 'إن كنت قد رأيت الدوحة بالفعل، فجولة شمال قطر التاريخية بـ1,100 ر.ق تأخذك إلى الجزء الذي لا يصله معظم الزوّار — قرية الجميل المهجورة، وقلعة الزبارة، وأشجار القرم في الذخيرة، وهي أهدأ مياه في البلاد.',
          },
        ],
      },
      {
        heading: { en: 'When to visit — and when not to', ar: 'متى تزور — ومتى لا تزور' },
        body: [
          {
            en: 'Qatar has one comfortable season and one difficult one. From late October to April the weather is genuinely pleasant, with daytime temperatures roughly in the low-to-mid twenties Celsius. This is when every outdoor activity in this guide is at its best, and also when you should book ahead, because it is when everyone else comes.',
            ar: 'لقطر موسم مريح واحد وآخر صعب. من أواخر أكتوبر حتى أبريل يكون الطقس لطيفاً فعلاً، وتتراوح درجات الحرارة نهاراً بين منتصف العشرينيات المئوية تقريباً. وهذا هو الوقت الذي تكون فيه كل الأنشطة الخارجية في هذا الدليل في أفضل حالاتها، وهو أيضاً الوقت الذي يجب أن تحجز فيه مسبقاً، لأنه الوقت الذي يأتي فيه الجميع.',
          },
          {
            en: 'June to August is a different proposition. Temperatures regularly exceed 45°C, and midday desert or open-water activity stops being enjoyable and starts being a genuine health consideration. If you are here in summer, shift everything to early morning or after sunset, and lean towards water rather than desert.',
            ar: 'أما من يونيو إلى أغسطس فالأمر مختلف. تتجاوز درجات الحرارة 45 مئوية بانتظام، وتتوقف الأنشطة الصحراوية أو البحرية في منتصف النهار عن كونها ممتعة لتصبح مسألة صحية حقيقية. إن كنت هنا في الصيف، فانقل كل شيء إلى الصباح الباكر أو ما بعد الغروب، ومِل إلى الماء بدلاً من الصحراء.',
          },
        ],
      },
      {
        heading: { en: 'What a day actually costs', ar: 'كم يكلّف اليوم فعلياً' },
        body: [
          {
            en: 'On a tight budget, a Full-Day Desert Safari at QAR 150 plus a Kayak Ride at QAR 100 gives you both landscapes Qatar is known for in one day for QAR 250. In the middle, a speedboat for four at QAR 350 and a Grand Doha City Tour at QAR 800 covers a comfortable day for a small group.',
            ar: 'بميزانية محدودة، سفاري صحراوي ليوم كامل بـ150 ر.ق مع جولة كاياك بـ100 ر.ق يمنحك المشهدين اللذين تشتهر بهما قطر في يوم واحد مقابل 250 ر.ق. وفي المستوى المتوسط، قارب سريع لأربعة أشخاص بـ350 ر.ق وجولة الدوحة الكبرى بـ800 ر.ق تغطّي يوماً مريحاً لمجموعة صغيرة.',
          },
          {
            en: 'If you are marking an occasion, a private yacht from QAR 1,200 or a houseboat from QAR 3,000 for a full day with a group is the version people remember. Almost every price on this page buys the whole boat or chalet rather than one seat, so a group splitting a charter usually pays less per person than several individual bookings would cost.',
            ar: 'وإن كنت تحتفل بمناسبة، فيخت خاص من 1,200 ر.ق أو بيت عائم من 3,000 ر.ق ليوم كامل مع مجموعة هو النسخة التي يتذكّرها الناس. وكل سعر تقريباً في هذه الصفحة يشمل القارب أو الشاليه بأكمله لا مقعداً واحداً، لذا فإن مجموعة تتقاسم رحلة خاصة تدفع للفرد أقل عادةً مما تكلّفه عدة حجوزات منفردة.',
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
    updated: '2026-08-26',
    title: {
      en: '2 Days in Doha: A Realistic Itinerary for 2026',
      ar: 'يومان في الدوحة: خطة رحلة واقعية لعام 2026',
    },
    description: {
      en: 'An hour-by-hour two-day Doha itinerary with real prices — city tour, desert safari, sunset on the water — built around what you can actually book.',
      ar: 'خطة رحلة ليومين في الدوحة ساعة بساعة مع أسعار حقيقية — جولة في المدينة، وسفاري صحراوي، وغروب على الماء — مبنية على ما يمكنك حجزه فعلاً.',
    },
    intro: {
      en: 'Two days is enough for Doha if you do not waste them. The city is compact and the desert is an hour away, so the realistic plan is one day in and around the city and one day out of it. This itinerary gives times, prices and a bookable option for each slot — and tells you honestly what to drop if you are visiting in summer.',
      ar: 'يومان يكفيان للدوحة إن لم تُهدرهما. المدينة صغيرة والصحراء على بُعد ساعة، لذا فالخطة الواقعية هي يوم داخل المدينة ومحيطها ويوم خارجها. تقدّم هذه الخطة الأوقات والأسعار وخياراً قابلاً للحجز لكل فترة — وتخبرك بصراحة بما يجب إسقاطه إن كنت تزور في الصيف.',
    },
    sections: [
      {
        heading: { en: 'Day 1, morning — the old city', ar: 'اليوم الأول، صباحاً — المدينة القديمة' },
        body: [
          {
            en: 'Start early, around 8am, at Souq Waqif while it is still cool and before the tour groups arrive. Give it two hours: the falcon souq, the spice alleys and breakfast at one of the courtyard cafés. From there the Museum of Islamic Art is a short drive along the Corniche.',
            ar: 'ابدأ باكراً، نحو الثامنة صباحاً، من سوق واقف بينما لا يزال الجو بارداً وقبل وصول المجموعات السياحية. امنحه ساعتين: سوق الصقور، وأزقة التوابل، وإفطاراً في أحد مقاهي الفناء. ومن هناك يبعد متحف الفن الإسلامي مسافة قصيرة بالسيارة على طول الكورنيش.',
          },
          {
            en: 'If you would rather not work out the logistics yourself, a Grand Doha City Tour at QAR 800 covers this stretch plus Katara, Msheireb and The Pearl in one guided run. A Private City Tour at QAR 1,000 does the same at your own pace, which is worth the QAR 200 difference if there are more than two of you.',
            ar: 'وإن كنت تفضّل ألا تتولى التنظيم بنفسك، فجولة الدوحة الكبرى بـ800 ر.ق تغطي هذا المسار إضافة إلى كتارا ومشيرب واللؤلؤة في جولة واحدة مع مرشد. أما الجولة الخاصة بـ1,000 ر.ق فتقدّم الشيء نفسه على وتيرتك، وتستحق فرق الـ200 ر.ق إن كنتم أكثر من شخصين.',
          },
        ],
      },
      {
        heading: { en: 'Day 1, afternoon — get on the water', ar: 'اليوم الأول، بعد الظهر — انزل إلى الماء' },
        body: [
          {
            en: 'The afternoon is the right time to see the skyline from the Gulf, and it is the single most photographed thing in Qatar for a reason. The cheap version is a Kayak Ride at QAR 100 or a single kayak at QAR 180. The comfortable version is a speedboat — QAR 350 for up to four people, QAR 450 for five, both an hour.',
            ar: 'بعد الظهر هو الوقت المناسب لرؤية أفق المدينة من الخليج، وهو أكثر ما يُصوَّر في قطر لسبب وجيه. النسخة الاقتصادية جولة كاياك بـ100 ر.ق أو كاياك فردي بـ180 ر.ق. أما النسخة المريحة فقارب سريع — 350 ر.ق حتى أربعة أشخاص، و450 ر.ق لخمسة، ومدّة كل منهما ساعة.',
          },
          {
            en: 'For something slower and more traditional, a Traditional Dhow rental is QAR 2,000 for four hours — sensible for a large group, expensive for a couple. Most departures are from Box Park on the old port side, so factor in the drive from wherever you had lunch.',
            ar: 'ولشيء أهدأ وأكثر أصالة، استئجار مركب داو تقليدي بـ2,000 ر.ق لأربع ساعات — منطقي لمجموعة كبيرة، ومكلف لشخصين. وتنطلق معظم الرحلات من بوكس بارك في ميناء الدوحة القديم، لذا احسب وقت الطريق من حيث تناولت الغداء.',
          },
        ],
      },
      {
        heading: { en: 'Day 1, evening — Katara and the Corniche', ar: 'اليوم الأول، مساءً — كتارا والكورنيش' },
        body: [
          {
            en: 'Katara Cultural Village comes alive after dark and costs nothing to walk around. The amphitheatre, the mosques and the beach are all within a few minutes of each other, and there is enough food there to make dinner easy. Finish with the Corniche promenade — the skyline view across the bay is better at night than in daylight.',
            ar: 'ينبض الحي الثقافي كتارا بالحياة بعد المغيب، والتجوّل فيه مجاني. المدرّج والمساجد والشاطئ كلها على بُعد دقائق من بعضها، وفيه من خيارات الطعام ما يجعل العشاء سهلاً. واختم بممشى الكورنيش — فمنظر الأفق عبر الخليج ليلاً أجمل منه نهاراً.',
          },
        ],
      },
      {
        heading: { en: 'Day 2 — the desert', ar: 'اليوم الثاني — الصحراء' },
        body: [
          {
            en: 'Give the whole second day to the Inland Sea. A Full-Day Desert Safari at QAR 150 per person is the best value in the catalogue and covers dune driving and the drive south to Khor Al Adaid, where the desert meets tidal seawater.',
            ar: 'خصّص اليوم الثاني بأكمله للبحر الداخلي. سفاري الصحراء ليوم كامل بـ150 ر.ق للشخص هو أفضل قيمة في الكتالوج، ويشمل القيادة على الكثبان والتوجّه جنوباً إلى خور العديد حيث تلتقي الصحراء بمياه البحر.',
          },
          {
            en: 'If you want the longer version, an eight-hour Safari trip is QAR 1,700. And if your flight is not until the following day, an Overnight Desert Safari at Sealine Camp at QAR 500 is the better ending — the stars there are the part people actually remember, and you cannot see them from the city.',
            ar: 'وإن أردت النسخة الأطول، فرحلة سفاري من ثماني ساعات بـ1,700 ر.ق. وإن كانت رحلتك في اليوم التالي، فسفاري صحراوي مع مبيت في مخيم سيلين بـ500 ر.ق نهاية أفضل — فالنجوم هناك هي ما يتذكّره الناس فعلاً، ولا يمكن رؤيتها من المدينة.',
          },
        ],
      },
      {
        heading: { en: 'If you have a third day', ar: 'إن كان لديك يوم ثالث' },
        body: [
          {
            en: 'Head north instead of south. The North of Qatar Historical Tour at QAR 1,100 takes in the abandoned village of Al Jumail, the Al Zubarah fort, and the Al Thakira mangroves — the calmest water in the country, and a completely different landscape from the dunes.',
            ar: 'اتجه شمالاً بدل الجنوب. جولة شمال قطر التاريخية بـ1,100 ر.ق تشمل قرية الجميل المهجورة وقلعة الزبارة وأشجار القرم في الذخيرة — أهدأ مياه في البلاد، ومشهد مختلف تماماً عن الكثبان.',
          },
        ],
      },
      {
        heading: { en: 'Practical notes', ar: 'ملاحظات عملية' },
        body: [
          {
            en: 'Doha is a driving city. Taxis and ride apps are cheap and plentiful, but almost nothing is comfortably walkable between districts, so build twenty to thirty minutes into each transition. The metro is clean and fast on the routes it covers, which includes the airport, Msheireb and Katara.',
            ar: 'الدوحة مدينة تعتمد على السيارة. سيارات الأجرة وتطبيقات النقل رخيصة ومتوفّرة، لكن التنقّل مشياً بين الأحياء غير مريح تقريباً، لذا احسب عشرين إلى ثلاثين دقيقة لكل انتقال. أما المترو فنظيف وسريع على الخطوط التي يغطيها، ومنها المطار ومشيرب وكتارا.',
          },
          {
            en: 'On timing: this itinerary assumes the October-to-April season. Between June and August, temperatures pass 45°C and the desert day should move to early morning or become an overnight instead. Book weekend activities ahead in peak season — Friday and Saturday are the local weekend in Qatar, so demand concentrates on those two days.',
            ar: 'أما التوقيت: تفترض هذه الخطة موسم أكتوبر إلى أبريل. وبين يونيو وأغسطس تتجاوز الحرارة 45 مئوية، وينبغي نقل يوم الصحراء إلى الصباح الباكر أو تحويله إلى مبيت. واحجز أنشطة نهاية الأسبوع مسبقاً في الموسم — فالجمعة والسبت هما عطلة نهاية الأسبوع المحلية في قطر، لذا يتركّز الطلب في هذين اليومين.',
          },
        ],
      },
    ],
    relatedLandings: ['desert-safari-qatar', 'doha-boat-tour', 'water-activities-qatar'],
  },
  {
    slug: 'best-time-for-desert-safari-qatar',
    published: true,
    priority: 0.6,
    updated: '2026-08-26',
    title: {
      en: 'Best Time for a Desert Safari in Qatar: Month by Month',
      ar: 'أفضل وقت لسفاري الصحراء في قطر: شهراً بشهر',
    },
    description: {
      en: 'When to book a Qatar desert safari, month by month — temperatures, day trips versus overnight camps, what to wear, and prices from QAR 150.',
      ar: 'متى تحجز سفاري الصحراء في قطر، شهراً بشهر — درجات الحرارة، ورحلات اليوم مقابل المبيت، وماذا ترتدي، والأسعار من 150 ر.ق.',
    },
    intro: {
      en: 'The short answer is November to March. But that hides a lot of useful detail — the shoulder months are cheaper and quieter, an overnight camp behaves very differently from a day trip, and summer is not simply "hot" but genuinely unsuitable for midday desert activity. Here is the month-by-month version.',
      ar: 'الإجابة المختصرة هي من نوفمبر إلى مارس. لكن هذا يخفي تفاصيل مفيدة كثيرة — فالأشهر الانتقالية أرخص وأهدأ، والمبيت في مخيم يختلف تماماً عن رحلة نهارية، والصيف ليس «حاراً» فحسب بل غير مناسب فعلياً للنشاط الصحراوي في منتصف النهار. وإليك التفصيل شهراً بشهر.',
    },
    sections: [
      {
        heading: { en: 'The short answer', ar: 'الإجابة المختصرة' },
        body: [
          {
            en: 'November through March is the comfortable window, with December to February the most reliable. Daytime temperatures sit in a range where dune driving, camel rides and sitting outside at a camp are all pleasant, and evenings are cool enough to want a jacket — which matters more than people expect, because the desert loses heat fast after sunset.',
            ar: 'من نوفمبر إلى مارس هي النافذة المريحة، وأكثرها ثباتاً من ديسمبر إلى فبراير. تكون درجات الحرارة نهاراً في نطاق يجعل القيادة على الكثبان وركوب الجمال والجلوس في الخارج بالمخيم أموراً ممتعة، وتكون الأمسيات باردة بما يكفي لترغب في سترة — وهو أمر أهم مما يتوقّعه الناس، لأن الصحراء تفقد حرارتها بسرعة بعد الغروب.',
          },
        ],
      },
      {
        heading: { en: 'Month by month', ar: 'شهراً بشهر' },
        body: [
          {
            en: 'October is the turning point. Early October can still be uncomfortably hot, but by the last week the evenings have cooled and overnight camps become appealing again. Prices and crowds are still below peak, which makes late October one of the better-value windows in the year.',
            ar: 'أكتوبر هو نقطة التحوّل. قد تكون بدايته لا تزال حارة بشكل غير مريح، لكن مع الأسبوع الأخير تبرد الأمسيات وتعود مخيمات المبيت جذّابة. وتظل الأسعار والازدحام دون الذروة، ما يجعل أواخر أكتوبر من أفضل الفترات قيمةً في السنة.',
          },
          {
            en: 'November to February is peak season and the reason most people visit Qatar in winter at all. Conditions are at their best and so is demand — book ahead, particularly for Friday and Saturday, which are the local weekend. This is also when an overnight camp is at its most rewarding, because the nights are properly cold and clear.',
            ar: 'من نوفمبر إلى فبراير هو موسم الذروة، وهو السبب في أن معظم الناس يزورون قطر شتاءً أصلاً. تكون الظروف في أفضل حالاتها وكذلك الطلب — فاحجز مسبقاً، خصوصاً للجمعة والسبت وهما عطلة نهاية الأسبوع المحلية. وهذا أيضاً أفضل وقت للمبيت في مخيم، لأن الليالي باردة وصافية فعلاً.',
          },
          {
            en: 'March and April are the second shoulder. March is still comfortable and noticeably quieter than February. By late April the heat is returning and midday activity starts to feel like work rather than a holiday, so shift towards morning departures.',
            ar: 'مارس وأبريل هما الفترة الانتقالية الثانية. لا يزال مارس مريحاً وأهدأ بوضوح من فبراير. ومع أواخر أبريل تعود الحرارة ويبدأ النشاط في منتصف النهار بالشعور وكأنه عمل لا عطلة، لذا اتجه إلى الانطلاق الصباحي.',
          },
          {
            en: 'May through September is the season to avoid for daytime desert activity. Peak summer regularly exceeds 45°C. Trips still run, but they should be early morning or evening only, and a water activity is the more sensible use of a summer afternoon than a dune drive.',
            ar: 'من مايو إلى سبتمبر هو الموسم الذي يجب تجنّبه للنشاط الصحراوي النهاري. تتجاوز ذروة الصيف 45 مئوية بانتظام. ولا تزال الرحلات تعمل، لكن ينبغي أن تكون في الصباح الباكر أو المساء فقط، والنشاط المائي استخدام أذكى لعصر صيفي من القيادة على الكثبان.',
          },
        ],
      },
      {
        heading: { en: 'Day trip or overnight?', ar: 'رحلة نهارية أم مبيت؟' },
        body: [
          {
            en: 'They are genuinely different experiences and the price gap is smaller than people assume. A Full-Day Desert Safari is QAR 150 per person and covers the dunes and the Inland Sea. An Overnight Desert Safari at the Sealine Camp is QAR 500 — for that you add the evening and, crucially, the night sky.',
            ar: 'هما تجربتان مختلفتان فعلاً، وفارق السعر أصغر مما يظن الناس. سفاري الصحراء ليوم كامل بـ150 ر.ق للشخص ويغطي الكثبان والبحر الداخلي. أما سفاري المبيت في مخيم سيلين فبـ500 ر.ق — وتضيف مقابله الأمسية، والأهم: سماء الليل.',
          },
          {
            en: 'If the stars are the reason you are going, the overnight is the only version that delivers, because Doha\'s light pollution reaches further than you would think. Longer packages exist too: an eight-hour Safari trip at QAR 1,700, a nineteen-hour full-day version at QAR 1,800, and Al Rehlah Camp at QAR 1,500.',
            ar: 'إن كانت النجوم هي سبب ذهابك، فالمبيت هو النسخة الوحيدة التي تحقّق ذلك، لأن التلوّث الضوئي للدوحة يمتد أبعد مما تتصوّر. وتوجد باقات أطول أيضاً: رحلة سفاري من ثماني ساعات بـ1,700 ر.ق، ونسخة يوم كامل من تسع عشرة ساعة بـ1,800 ر.ق، ومخيم الرحلة بـ1,500 ر.ق.',
          },
        ],
      },
      {
        heading: { en: 'What to bring', ar: 'ماذا تحضر' },
        body: [
          {
            en: 'Closed shoes rather than sandals — sand gets everywhere and the dunes are steeper than they look from the road. Sunglasses and sunscreen regardless of season, because the glare off pale sand is relentless even in January. A jacket or fleece for the evening, especially on an overnight; the temperature drop after sunset surprises most first-time visitors.',
            ar: 'أحذية مغلقة بدل الصنادل — فالرمل يتسلل إلى كل مكان والكثبان أشدّ انحداراً مما تبدو من الطريق. ونظارة شمسية وواقٍ من الشمس في أي موسم، لأن انعكاس الضوء عن الرمل الفاتح لا يرحم حتى في يناير. وسترة أو معطف خفيف للمساء، خصوصاً في المبيت؛ فانخفاض الحرارة بعد الغروب يفاجئ معظم الزوار لأول مرة.',
          },
          {
            en: 'On dune driving specifically: it is a rollercoaster, not a scenic drive. If anyone in your group is prone to motion sickness, eat lightly beforehand and say so to the driver before you set off — asking for a gentler run is a normal request, and much easier to make at the start than halfway up a dune.',
            ar: 'وعن القيادة على الكثبان تحديداً: إنها أشبه بأفعوانية لا برحلة مناظر. إن كان أحد في مجموعتك عرضة لدوار الحركة، فتناول طعاماً خفيفاً قبلها وأخبر السائق قبل الانطلاق — فطلب جولة ألطف أمر معتاد، ومن الأسهل بكثير قوله في البداية لا في منتصف كثيب رملي.',
          },
        ],
      },
      {
        heading: { en: 'Booking ahead', ar: 'الحجز المسبق' },
        body: [
          {
            en: 'In peak season, book a few days out if you want a weekend departure. Friday and Saturday are the local weekend in Qatar, so that is when demand concentrates — the same two days everyone else is also free. Outside the peak months there is far more availability.',
            ar: 'في موسم الذروة، احجز قبل أيام إن أردت انطلاقة في نهاية الأسبوع. فالجمعة والسبت هما عطلة نهاية الأسبوع المحلية في قطر، وفيهما يتركّز الطلب — اليومان نفسهما اللذان يكون فيهما الجميع متفرّغاً. أما خارج أشهر الذروة فالتوافر أكبر بكثير.',
          },
        ],
      },
    ],
    relatedLandings: ['desert-safari-qatar', 'caravan-rental-qatar', 'resorts-chalets-qatar'],
  },
  {
    // ── DRAFT — published:false. Renders but noindex, and excluded from the
    // blog index + sitemap, so nothing is public until the owner approves.
    // Open fact-checks live in JADWAL_GUIDE_CONTENT_GAPS.md (owner's desktop).
    slug: 'best-water-activities-in-doha',
    published: true,
    priority: 0.7,
    updated: '2026-08-26',
    title: {
      en: 'Best Water Activities in Doha 2026: Prices and What to Book',
      ar: 'أفضل الأنشطة المائية في الدوحة 2026: الأسعار وما الذي تحجزه',
    },
    description: {
      en: 'Kayaking from QAR 100, speedboats from QAR 350, yachts from QAR 1,200 — the best water activities in Doha grouped by budget, with real bookable prices.',
      ar: 'تجديف من 100 ر.ق، وقوارب سريعة من 350 ر.ق، ويخوت من 1,200 ر.ق — أفضل الأنشطة المائية في الدوحة مرتّبة حسب الميزانية، بأسعار حقيقية قابلة للحجز.',
    },
    intro: {
      en: 'Doha sits on the Gulf, and almost everything worth doing here eventually involves getting on the water. The problem when you search for it is that most guides list activities without prices, so you cannot tell whether you are looking at a QAR 100 afternoon or a QAR 3,800 one. This guide is organised by what it costs, because that is the actual question.',
      ar: 'تقع الدوحة على الخليج، وكل ما يستحق القيام به هنا ينتهي تقريباً بالنزول إلى الماء. والمشكلة عند البحث أن معظم الأدلة تسرد الأنشطة دون أسعار، فلا تعرف إن كنت أمام فترة بعد ظهر بـ100 ر.ق أم بـ3,800 ر.ق. هذا الدليل مرتّب حسب التكلفة، لأن ذلك هو السؤال الحقيقي.',
    },
    sections: [
      {
        heading: { en: 'Under QAR 300 — first time on the water', ar: 'أقل من 300 ر.ق — أول مرة على الماء' },
        body: [
          {
            en: 'Kayaking is the cheapest way onto the Gulf and the easiest to do with no experience. A Kayak Ride is QAR 100 for an hour and a Kayaking Single QAR 180, both seating one. A Kayaking Double is QAR 280 and seats two — the one to pick if you are nervous, because sharing a boat with someone steadier makes a considerable difference on a first outing.',
            ar: 'التجديف أرخص طريقة للنزول إلى الخليج وأسهلها دون خبرة سابقة. جولة الكاياك بـ100 ر.ق لمدة ساعة، والكاياك الفردي بـ180 ر.ق، وكلاهما لشخص واحد. أما الكاياك المزدوج فبـ280 ر.ق ويتّسع لشخصين — وهو الخيار المناسب إن كنت متوتراً، فمشاركة القارب مع شخص أثبت تُحدث فرقاً كبيراً في أول خروج.',
          },
          {
            en: 'The other option in this band is Public Al Safliya Island Water Sports at QAR 125, a four-hour trip out to Al Safliya island. Note that this one is priced per person rather than per boat — almost everything else on this page is for the whole vessel. For the money it is the broadest experience here: you get the crossing and time in the water, not one or the other.',
            ar: 'والخيار الآخر في هذه الفئة هو الرياضات المائية العامة في جزيرة الصفلية بـ125 ر.ق، وهي رحلة من أربع ساعات إلى جزيرة الصفلية. لاحظ أن سعرها يُحسب للشخص لا للقارب — بخلاف كل ما تبقّى في هذه الصفحة تقريباً الذي يُحسب للقارب كاملاً. وبهذا المبلغ تُعدّ أوسع تجربة هنا: تحصل على العبور والوقت في الماء معاً لا أحدهما.',
          },
        ],
      },
      {
        heading: { en: 'QAR 350–900 — speedboats and the fun stuff', ar: 'من 350 إلى 900 ر.ق — القوارب السريعة والمرح' },
        body: [
          {
            en: 'Speedboats are priced for the whole boat rather than per person, which makes them progressively better value the more of you there are. They run an hour each: QAR 350 for up to four people, QAR 450 for five, QAR 600 for eight. There is also a standard Speed boat at QAR 550 for seven, the Dragon and C Princess at QAR 500 each for five, and the Q Speed Boat at QAR 800 for ten — which works out at QAR 80 a head, the cheapest way to get a large group out together.',
            ar: 'تُسعَّر القوارب السريعة للقارب كاملاً لا للشخص، ما يجعل قيمتها أفضل كلما زاد عددكم. ومدّتها ساعة لكل منها: 350 ر.ق حتى أربعة أشخاص، و450 ر.ق لخمسة، و600 ر.ق لثمانية. وهناك أيضاً قارب سريع قياسي بـ550 ر.ق لسبعة، وقاربا Dragon وC Princess بـ500 ر.ق لكل منهما لخمسة، وقارب Q السريع بـ800 ر.ق لعشرة — أي نحو 80 ر.ق للفرد، وهي أرخص طريقة لإخراج مجموعة كبيرة معاً.',
          },
          {
            en: 'For something more active, a Wakeboard session is QAR 550 for up to five. Banana rides — the inflatable towed behind a boat, and the one activity groups reliably end up laughing through — are QAR 600 for the Banana Ride, seating five, and QAR 865 for the Banana Boat Ride, seating six. All of these run an hour.',
            ar: 'ولشيء أكثر حركة، جلسة تزلّج على الماء بـ550 ر.ق حتى خمسة أشخاص. أما ركوب الموزة — القارب المطاطي المسحوب خلف قارب، وهو النشاط الذي تنتهي به المجموعات ضاحكة دائماً — فبـ600 ر.ق لركوب الموزة لخمسة أشخاص، و865 ر.ق لقارب الموزة لستة. ومدّة كل منها ساعة.',
          },
        ],
      },
      {
        heading: { en: 'QAR 1,000–1,800 — yachts, fishing and flying', ar: 'من 1,000 إلى 1,800 ر.ق — يخوت وصيد وطيران' },
        body: [
          {
            en: 'This is where private charters begin, and the differences are in duration and size rather than price alone. The C-Ray Luxury Yacht is QAR 1,200 for two hours and takes five. The Versace Yacht and the Luxury Yacht Rental in Doha are QAR 1,500 for three hours and take fifteen — the best group-to-cost ratio in this band. The Q Luxury Yacht is QAR 1,600 for three hours and takes twelve. The Mini Yacht Ride is also QAR 1,500 but only an hour, for nine.',
            ar: 'هنا تبدأ الرحلات الخاصة، والفروق بينها في المدة والحجم لا في السعر وحده. يخت C-Ray الفاخر بـ1,200 ر.ق لساعتين ويتّسع لخمسة. ويخت فيرزاتشي وتأجير يخت فاخر في الدوحة بـ1,500 ر.ق لثلاث ساعات ويتّسعان لخمسة عشر — وهي أفضل نسبة بين حجم المجموعة والتكلفة في هذه الفئة. ويخت Q الفاخر بـ1,600 ر.ق لثلاث ساعات ويتّسع لاثني عشر. أما جولة اليخت الصغير فبـ1,500 ر.ق أيضاً لكن لساعة واحدة، لتسعة أشخاص.',
          },
          {
            en: 'A Catamaran is QAR 1,800 for four hours and takes ten. It is the steadier hull of everything in this band, which is worth knowing if anyone aboard is unsure about boats or prone to seasickness.',
            ar: 'والكاتاماران بـ1,800 ر.ق لأربع ساعات ويتّسع لعشرة. وهو أثبت الهياكل في هذه الفئة كلها، وهو أمر يستحق المعرفة إن كان أحد الركاب غير مطمئن للقوارب أو عرضة لدوار البحر.',
          },
          {
            en: 'Fishing sits in the same band and all three options run four hours: the Balhambar Boat Fishing Trip and the Marlin Speed Boat Fishing Trip are QAR 1,500 for up to seven, and a general Speedboat Fishing trip is QAR 1,500 for four. For the adrenaline end, Fly Board with Supercharge Jetski is QAR 1,000 for three people and the Jetboat QAR 1,000 for six, both an hour.',
            ar: 'ويقع الصيد في الفئة نفسها وتمتد خياراته الثلاثة أربع ساعات: رحلة صيد قارب بالحمبار ورحلة صيد قارب مارلين السريع بـ1,500 ر.ق حتى سبعة أشخاص، ورحلة الصيد بقارب سريع بـ1,500 ر.ق لأربعة. وفي طرف الأدرينالين، الفلاي بورد مع الجيت سكي بـ1,000 ر.ق لثلاثة أشخاص والجت بوت بـ1,000 ر.ق لستة، ومدّة كل منهما ساعة.',
          },
        ],
      },
      {
        heading: { en: 'QAR 2,000 and up — full-day charters', ar: 'من 2,000 ر.ق فأكثر — رحلات اليوم الكامل' },
        body: [
          {
            en: 'At the top end you are chartering the whole vessel, and the capacities change the arithmetic completely. A Traditional Dhow rental is QAR 2,000 for four hours and holds up to 105 people — at capacity that is roughly QAR 19 a head, which makes the most traditional boat on this page also the cheapest per person, undercutting a single kayak. The Safliyah water sports Trip is QAR 2,500 for five hours and takes 60.',
            ar: 'في الفئة العليا أنت تستأجر القارب بأكمله، والسعات تغيّر الحساب تماماً. استئجار مركب داو تقليدي بـ2,000 ر.ق لأربع ساعات ويتّسع حتى 105 أشخاص — أي نحو 19 ر.ق للفرد عند اكتمال السعة، ما يجعل أعرق قارب في هذه الصفحة أرخصها أيضاً للشخص الواحد، بأقل من كاياك فردي. ورحلة الرياضات المائية في الصفلية بـ2,500 ر.ق لخمس ساعات وتتّسع لستين.',
          },
          {
            en: 'Houseboats are the most expensive per booking and all run four hours: the Royal Home Houseboat at QAR 3,000 for 25 people, the Q Houseboat at QAR 3,000 for 20, and a standard Houseboat at QAR 3,800 for 25. The dhow is still worth singling out though — it is the wooden boat Qatar built its pearling economy on, which makes it the one trip on this page that is about the country rather than the view.',
            ar: 'والبيوت العائمة هي الأغلى في الحجز الواحد ومدّتها جميعاً أربع ساعات: بيت Royal Home العائم بـ3,000 ر.ق لخمسة وعشرين شخصاً، وبيت Q العائم بـ3,000 ر.ق لعشرين، والبيت العائم القياسي بـ3,800 ر.ق لخمسة وعشرين. ومع ذلك يستحق الداو إفراداً بالذكر — فهو القارب الخشبي الذي بنت عليه قطر اقتصاد اللؤلؤ، وهو ما يجعله الرحلة الوحيدة في هذه الصفحة التي تدور حول البلد لا حول المنظر.',
          },
        ],
      },
      {
        heading: { en: 'When to go out on the water', ar: 'متى تخرج إلى الماء' },
        body: [
          {
            en: 'October to April is the comfortable season, and late afternoon into sunset is the best slot in the day — the light on the skyline is the reason most people take these trips at all. Between June and August the middle of the day is genuinely too hot to enjoy on open water; go early morning or after sunset instead.',
            ar: 'من أكتوبر إلى أبريل هو الموسم المريح، وأفضل فترة في اليوم هي من العصر حتى الغروب — فالضوء على الأفق هو السبب الذي يدفع معظم الناس لهذه الرحلات أصلاً. وبين يونيو وأغسطس يكون منتصف النهار حاراً فعلاً بحيث لا يمكن الاستمتاع به على الماء المكشوف؛ فاخرج في الصباح الباكر أو بعد الغروب.',
          },
          {
            en: 'For the calmest water in the country, the Al Thakira mangroves up north are a different kind of outing altogether — sheltered, slow, and better for spotting birds than for speed.',
            ar: 'وللحصول على أهدأ مياه في البلاد، فإن أشجار القرم في الذخيرة شمالاً نزهة من نوع مختلف تماماً — محميّة وهادئة، وأفضل لمراقبة الطيور منها للسرعة.',
          },
        ],
      },
      {
        heading: { en: 'Practical notes before you book', ar: 'ملاحظات عملية قبل الحجز' },
        body: [
          {
            en: 'Most of these boats are listed at Box Park, so allow travel time from wherever you are staying. Book ahead for Friday and Saturday — the local weekend in Qatar, and so the days demand concentrates on, particularly in peak season.',
            ar: 'معظم هذه القوارب مُدرجة في بوكس بارك، لذا احسب وقت التنقّل من مكان إقامتك. واحجز مسبقاً ليومي الجمعة والسبت — عطلة نهاية الأسبوع المحلية في قطر، وبالتالي اليومان اللذان يتركّز فيهما الطلب — خصوصاً في موسم الذروة.',
          },
          {
            en: 'Bring more sun protection than you think you need; glare off the water roughly doubles the exposure. And understand how these prices work: with one exception on this page — Public Al Safliya Island Water Sports, which is per person — every price quoted here is for the entire boat, however many of you board it. That changes the arithmetic completely. A QAR 800 Q Speed Boat is QAR 80 each for ten people. Work out the per-head figure before deciding something is out of reach.',
            ar: 'أحضر من الحماية من الشمس أكثر مما تظن أنك تحتاج؛ فانعكاس الضوء عن الماء يضاعف التعرّض تقريباً. وافهم كيف تعمل هذه الأسعار: باستثناء واحد في هذه الصفحة — الرياضات المائية العامة في جزيرة الصفلية التي تُحسب للشخص — كل سعر مذكور هنا هو للقارب بأكمله مهما كان عددكم على متنه. وهذا يغيّر الحساب تماماً. فقارب Q السريع بـ800 ر.ق يصبح 80 ر.ق للفرد بعشرة أشخاص. احسب نصيب الفرد قبل أن تقرّر أن شيئاً ما بعيد عن متناولك.',
          },
        ],
      },
    ],
    relatedLandings: ['water-activities-qatar', 'yacht-rental-qatar', 'doha-boat-tour'],
  },
  {
    // ── DRAFT — published:false. See the note on best-water-activities-in-doha.
    //
    // DELIBERATE SCOPE SPLIT: this guide stays INSIDE Doha and leans towards
    // short-trip, no-car visitors. `things-to-do-in-qatar` covers the whole
    // country (Sealine, Al Khor, the north). Two pages saying the same thing
    // compete with each other and both lose, so keep that boundary when editing.
    slug: 'best-activities-to-do-in-doha',
    published: true,
    priority: 0.7,
    updated: '2026-08-26',
    title: {
      en: 'Best Activities to Do in Doha 2026: A Local Guide with Prices',
      ar: 'أفضل الأنشطة في الدوحة 2026: دليل محلي مع الأسعار',
    },
    description: {
      en: 'The best activities in Doha with real prices — city tours from QAR 800, boat trips from QAR 100, desert safaris from QAR 150, and where each one starts.',
      ar: 'أفضل الأنشطة في الدوحة مع أسعار حقيقية — جولات المدينة من 800 ر.ق، ورحلات القوارب من 100 ر.ق، وسفاري الصحراء من 150 ر.ق، ومن أين تبدأ كل منها.',
    },
    intro: {
      en: 'Doha is a compact city with a lot packed into it, and most of what is worth doing is either on the water, in the old city, or an hour south in the desert. This guide covers the activities that are genuinely worth booking, what each one costs, and roughly where it starts — written for a visitor with a few days and no car.',
      ar: 'الدوحة مدينة صغيرة تضم الكثير، ومعظم ما يستحق القيام به إما على الماء أو في المدينة القديمة أو على بُعد ساعة جنوباً في الصحراء. يغطي هذا الدليل الأنشطة التي تستحق الحجز فعلاً، وكم تكلّف كل منها، ومن أين تبدأ تقريباً — وهو مكتوب لزائر لديه بضعة أيام وبلا سيارة.',
    },
    sections: [
      {
        heading: { en: 'See the skyline from the water', ar: 'شاهد أفق المدينة من الماء' },
        body: [
          {
            en: 'This is the defining Doha activity and the cheapest good one. A Kayak Ride is QAR 100 for an hour, a single kayak QAR 180, a double QAR 280. If you would rather sit than paddle, a speedboat is QAR 350 for up to four people or QAR 450 for five — and because the price covers the boat, not the seat, it drops fast per person once there are a few of you.',
            ar: 'هذا هو النشاط الذي يميّز الدوحة، وأرخص الخيارات الجيدة. جولة الكاياك بـ100 ر.ق لساعة، والكاياك الفردي بـ180 ر.ق، والمزدوج بـ280 ر.ق. وإن كنت تفضّل الجلوس على التجديف، فالقارب السريع بـ350 ر.ق حتى أربعة أشخاص أو 450 ر.ق لخمسة — ولأن السعر يشمل القارب لا المقعد، فإنه ينخفض سريعاً للفرد متى كنتم عدة أشخاص.',
          },
          {
            en: 'For an occasion, a private yacht starts at QAR 1,200 for the C-Ray and QAR 1,600 for the Q Luxury Yacht. A Traditional Dhow at QAR 2,000 is the more characterful choice — a wooden pearling boat rather than a modern hull. Departures are generally from Box Park on the old port side.',
            ar: 'وللمناسبات، يبدأ اليخت الخاص من 1,200 ر.ق ليخت C-Ray و1,600 ر.ق ليخت Q الفاخر. أما مركب الداو التقليدي بـ2,000 ر.ق فهو الخيار الأكثر طابعاً — قارب لؤلؤ خشبي بدل هيكل حديث. وتنطلق الرحلات عموماً من بوكس بارك في الميناء القديم.',
          },
        ],
      },
      {
        heading: { en: 'The old city on foot', ar: 'المدينة القديمة سيراً على الأقدام' },
        body: [
          {
            en: 'Souq Waqif is the one part of Doha that rewards wandering without a plan. Go early morning or after dark — the middle of the day is hot and the souq is quiet. The falcon souq, the spice alleys and the courtyard cafés are all within a few minutes of each other, and it costs nothing to walk through.',
            ar: 'سوق واقف هو الجزء الوحيد من الدوحة الذي يكافئ التجوّل دون خطة. اذهب في الصباح الباكر أو بعد المغيب — فمنتصف النهار حار والسوق هادئ. سوق الصقور وأزقة التوابل ومقاهي الفناء كلها على بُعد دقائق من بعضها، والتجوّل فيه مجاني.',
          },
          {
            en: 'A Grand Doha City Tour at QAR 800 covers the souq along with Katara Cultural Village, Msheireb and The Pearl in one guided run, which solves the transport problem — almost nothing in Doha is comfortably walkable between districts. A Private City Tour at QAR 1,000 does the same at your own pace.',
            ar: 'وجولة الدوحة الكبرى بـ800 ر.ق تغطي السوق مع الحي الثقافي كتارا ومشيرب واللؤلؤة في جولة واحدة مع مرشد، ما يحلّ مشكلة التنقّل — فلا يكاد شيء في الدوحة يكون مريحاً للمشي بين الأحياء. أما الجولة الخاصة بـ1,000 ر.ق فتقدّم الشيء نفسه على وتيرتك.',
          },
        ],
      },
      {
        heading: { en: 'The desert, an hour away', ar: 'الصحراء على بُعد ساعة' },
        body: [
          {
            en: 'You do not need to leave Doha for long to reach real desert. A Full-Day Desert Safari at QAR 150 per person is the best-value activity available and runs south to the Inland Sea at Khor Al Adaid, where the dunes meet tidal seawater. Operators use 4x4s because the last stretch is over sand.',
            ar: 'لا تحتاج للابتعاد كثيراً عن الدوحة للوصول إلى صحراء حقيقية. سفاري الصحراء ليوم كامل بـ150 ر.ق للشخص هو أفضل نشاط من حيث القيمة، ويتجه جنوباً إلى البحر الداخلي في خور العديد حيث تلتقي الكثبان بمياه البحر. ويستخدم المشغّلون سيارات الدفع الرباعي لأن المسافة الأخيرة فوق الرمل.',
          },
          {
            en: 'If you have a free evening rather than a free day, an Overnight Desert Safari at Sealine Camp is QAR 500. The stars are the actual reason to do it — Doha\'s light reaches further than you would expect, and you will not see a sky like that from the city.',
            ar: 'وإن كان لديك مساء حر بدل يوم حر، فسفاري صحراوي مع مبيت في مخيم سيلين بـ500 ر.ق. والنجوم هي السبب الحقيقي للقيام به — فضوء الدوحة يمتد أبعد مما تتوقّع، ولن ترى سماءً كهذه من المدينة.',
          },
        ],
      },
      {
        heading: { en: 'Something more active', ar: 'شيء أكثر حركة' },
        body: [
          {
            en: 'For groups after adrenaline rather than scenery, Fly Board with Supercharge Jetski is QAR 1,000 for three and the Jetboat QAR 1,000 for six, a Wakeboard session QAR 550 for five, and banana rides QAR 600 to QAR 865. Fishing trips run four hours at QAR 1,500 across the Balhambar, Marlin and general speedboat options.',
            ar: 'للمجموعات الباحثة عن الأدرينالين لا المناظر، الفلاي بورد مع الجيت سكي بـ1,000 ر.ق لثلاثة أشخاص والجت بوت بـ1,000 ر.ق لستة، وجلسة التزلج على الماء بـ550 ر.ق لخمسة، وركوب الموزة من 600 إلى 865 ر.ق. أما رحلات الصيد فأربع ساعات بـ1,500 ر.ق عبر خيارات بالحمبار ومارلين والقارب السريع العام.',
          },
        ],
      },
      {
        heading: { en: 'If you want a base outside the city', ar: 'إن أردت قاعدة خارج المدينة' },
        body: [
          {
            en: 'Renting a private place for a weekend is normal here. A Lusail Apartment is QAR 800, caravans start at QAR 1,050 for the Al Marona VIP, and full resorts and chalets run from QAR 1,200 for Cavilam Resort up to QAR 2,600 for Al Kadi Resort or J Rest Private Chalet. These suit groups who would rather have a kitchen and privacy than a hotel room.',
            ar: 'استئجار مكان خاص لعطلة نهاية الأسبوع أمر معتاد هنا. شقة في لوسيل بـ800 ر.ق، وتبدأ الكرفانات من 1,050 ر.ق لكرفان المارونة VIP، وتتراوح المنتجعات والشاليهات الكاملة من 1,200 ر.ق لمنتجع كافيلام حتى 2,600 ر.ق لمنتجع الكادي أو شاليه J Rest الخاص. وتناسب هذه المجموعات التي تفضّل مطبخاً وخصوصية على غرفة فندقية.',
          },
        ],
      },
      {
        heading: { en: 'Getting around and when to come', ar: 'التنقّل ومتى تأتي' },
        body: [
          {
            en: 'Doha is a driving city. Taxis and ride apps are cheap and everywhere, and the metro is fast on the lines it covers — including the airport, Msheireb and Katara. Between districts, allow twenty to thirty minutes. Walking between neighbourhoods is not realistic for most of the year.',
            ar: 'الدوحة مدينة تعتمد على السيارة. سيارات الأجرة وتطبيقات النقل رخيصة ومنتشرة، والمترو سريع على الخطوط التي يغطيها — ومنها المطار ومشيرب وكتارا. واحسب عشرين إلى ثلاثين دقيقة بين الأحياء. أما المشي بين المناطق فغير واقعي في معظم أشهر السنة.',
          },
          {
            en: 'Come between October and April if you can. June to August passes 45°C, which rules out midday outdoor activity — in summer, shift to early morning or evening and choose water over desert. Friday and Saturday are the local weekend, so book ahead for those two days in particular.',
            ar: 'تعال بين أكتوبر وأبريل إن استطعت. فمن يونيو إلى أغسطس تتجاوز الحرارة 45 مئوية، ما يستبعد النشاط الخارجي في منتصف النهار — وفي الصيف انتقل إلى الصباح الباكر أو المساء واختر الماء بدل الصحراء. والجمعة والسبت هما عطلة نهاية الأسبوع المحلية، فاحجز مسبقاً لهذين اليومين تحديداً.',
          },
        ],
      },
    ],
    relatedLandings: ['doha-boat-tour', 'water-activities-qatar', 'desert-safari-qatar'],
  },
];

export function getGuide(slug: string): SeoGuide | undefined {
  return SEO_GUIDES.find((g) => g.slug === slug);
}

export function allGuideSlugs(): string[] {
  return SEO_GUIDES.map((g) => g.slug);
}

export function publishedGuides(): SeoGuide[] {
  return SEO_GUIDES.filter((g) => g.published).sort((a, b) => b.priority - a.priority);
}

export function tr(text: LocalizedText, lang: LandingLang): string {
  return lang === 'ar' ? text.ar : text.en;
}
