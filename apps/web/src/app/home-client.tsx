'use client';

import Link from 'next/link';
import {
  Calendar,
  Gift,
  Headphones,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform, useInView, animate } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import Footer from '@/components/footer';
import Navbar from '@/components/navbar';
import CustomSelect from '@/components/custom-select';
import { useGeo } from '@/context/geo-context';
import {
  ActivityCard,
  type ActivityCardActivity,
  CategoryPill,
  PatternDivider,
  SectionHeader,
} from '@/components/ui';

/* ─── Animated Counter ───────────────────────────────────── */

function AnimatedCounter({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(decimals > 0 ? '0.0' : '0');

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 2,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [inView, value, decimals]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/* ─── Types ───────────────────────────────────────────────── */

interface TrendingEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  image: string | null;
  eventDate: string | null;
  countryId: string | null;
}

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  image: string | null;
  _count?: { activities: number };
}

type HomeActivity = ActivityCardActivity & {
  pricingModel?: string;
  distanceKm?: number;
  category?: { nameEn?: string; nameAr?: string; slug: string } | null;
};

/* ─── Component ───────────────────────────────────────────── */

export default function Home() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const { country, city, isDetecting, location, locationStatus, requestLocation } =
    useGeo();

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    router.push(`/explore${params.toString() ? `?${params.toString()}` : ''}`);
  }, [searchQuery, selectedCategory, router]);

  // Trending events — scoped to detected country; global events (no country) always shown
  const trendingParams = new URLSearchParams();
  if (country?.id) trendingParams.set('countryId', country.id);

  const { data: trendingEvents = [] } = useQuery<TrendingEvent[]>({
    queryKey: ['public-trending', country?.id],
    queryFn: () =>
      api
        .get(
          `/catalog/trending${trendingParams.toString() ? `?${trendingParams}` : ''}`,
        )
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  // Featured activities — filtered by detected country
  const featuredParams = new URLSearchParams({ limit: '6', featured: 'true' });
  if (country?.id) featuredParams.set('countryId', country.id);

  const { data: featuredActivitiesData } = useQuery<{ data: HomeActivity[] }>({
    queryKey: ['public-activities-featured', country?.id],
    queryFn: () =>
      api.get(`/catalog/activities?${featuredParams}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting,
  });
  const featuredActivities = featuredActivitiesData?.data ?? [];

  // "Near You" activities — filtered by country, sorted by proximity when location available
  const nearYouParams = new URLSearchParams({ limit: '6' });
  if (country?.id) nearYouParams.set('countryId', country.id);
  if (location) {
    nearYouParams.set('lat', String(location.lat));
    nearYouParams.set('lng', String(location.lng));
  }

  const { data: nearYouData } = useQuery<{ data: HomeActivity[] }>({
    queryKey: ['public-activities-near', country?.id, location?.lat, location?.lng],
    queryFn: () =>
      api.get(`/catalog/activities?${nearYouParams}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting && !!country,
  });
  const nearYouActivities = nearYouData?.data ?? [];

  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroBgY = useTransform(heroProgress, [0, 1], ['0%', '30%']);
  const cloudsY = useTransform(heroProgress, [0, 1], ['0%', '20%']);
  const contentY = useTransform(heroProgress, [0, 1], ['0%', '15%']);
  const heroOpacity = useTransform(heroProgress, [0, 0.8], [1, 0]);

  const countryName = country ? localized(country, 'name') : '';
  const eyebrow = isRtl
    ? countryName
      ? `${countryName} · تجارب محلية`
      : 'تجارب محلية في الخليج'
    : countryName
      ? `${countryName} · Local experiences`
      : 'Local experiences in the Gulf';

  return (
    // `relative` is required so Framer Motion's `useScroll({ target: heroRef })`
    // can compute parallax offsets — it silently warns otherwise.
    <div className="relative min-h-screen bg-jadwal-bg font-outfit">
      <Navbar />

      {/* ─── Hero (parallax boat/sun/moon/clouds/waves preserved) ─── */}
      <section
        ref={heroRef}
        className="relative overflow-hidden min-h-svh flex flex-col"
      >
        {/* Sky gradient — day/night based on theme */}
        <motion.div
          style={{ y: heroBgY }}
          className="absolute inset-0 bg-linear-to-b from-[#1a3a5c] via-[#2a6496] to-[#4ab0d8] dark:from-[#0a0f1a] dark:via-[#111827] dark:to-[#1e3a5f] will-change-transform"
        />

        {/* Sun (light mode) */}
        <motion.div
          style={{ y: heroBgY }}
          className="dark:hidden absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none will-change-transform"
        >
          <div className="hero-sun-glow absolute -inset-16 sm:-inset-20 bg-amber-300/30 rounded-full blur-[60px]" />
          <div className="hero-sun-glow absolute -inset-8 sm:-inset-10 bg-yellow-200/40 rounded-full blur-[30px]" />
          <div className="hero-sun relative">
            <svg
              width="90"
              height="90"
              viewBox="0 0 100 100"
              className="w-16 h-16 sm:w-20 sm:h-20 md:w-[90px] md:h-[90px] drop-shadow-[0_0_30px_rgba(251,191,36,0.6)]"
            >
              <g opacity="0.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <line
                    key={i}
                    x1="50"
                    y1="5"
                    x2="50"
                    y2="15"
                    stroke="#FCD34D"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    transform={`rotate(${i * 30} 50 50)`}
                  />
                ))}
              </g>
              <circle cx="50" cy="50" r="24" fill="url(#sunGrad)" />
              <ellipse
                cx="43"
                cy="43"
                rx="8"
                ry="6"
                fill="white"
                opacity="0.3"
                transform="rotate(-20 43 43)"
              />
              <defs>
                <radialGradient id="sunGrad" cx="45%" cy="40%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="60%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </radialGradient>
              </defs>
            </svg>
          </div>
        </motion.div>

        {/* Moon (dark mode) */}
        <motion.div
          style={{ y: heroBgY }}
          className="hidden dark:block absolute top-20 sm:top-28 md:top-32 right-[12%] z-6 pointer-events-none will-change-transform"
        >
          <div className="hero-moon-glow absolute -inset-16 sm:-inset-20 bg-blue-300/15 rounded-full blur-[60px]" />
          <div className="hero-moon-glow absolute -inset-8 sm:-inset-10 bg-slate-200/10 rounded-full blur-[30px]" />
          <svg
            width="80"
            height="80"
            viewBox="0 0 100 100"
            className="w-14 h-14 sm:w-[72px] sm:h-[72px] md:w-20 md:h-20 drop-shadow-[0_0_25px_rgba(148,163,184,0.4)]"
          >
            <circle cx="50" cy="50" r="28" fill="url(#moonGrad)" />
            <circle cx="62" cy="40" r="22" fill="#111827" />
            <circle cx="40" cy="55" r="4" fill="#CBD5E1" opacity="0.15" />
            <circle cx="48" cy="65" r="2.5" fill="#CBD5E1" opacity="0.1" />
            <circle cx="35" cy="45" r="2" fill="#CBD5E1" opacity="0.12" />
            <circle cx="15" cy="20" r="1.2" fill="white" opacity="0.7" />
            <circle cx="80" cy="75" r="1" fill="white" opacity="0.5" />
            <circle cx="25" cy="80" r="0.8" fill="white" opacity="0.4" />
            <circle cx="78" cy="18" r="1.5" fill="white" opacity="0.6" />
            <circle cx="10" cy="60" r="0.7" fill="white" opacity="0.3" />
            <defs>
              <radialGradient id="moonGrad" cx="40%" cy="40%">
                <stop offset="0%" stopColor="#F1F5F9" />
                <stop offset="50%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#94A3B8" />
              </radialGradient>
            </defs>
          </svg>
        </motion.div>

        <motion.div
          style={{ y: heroBgY }}
          className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-amber-300/20 dark:bg-blue-400/10 rounded-full blur-[100px] pointer-events-none will-change-transform"
        />

        {/* Clouds */}
        <motion.div
          style={{ y: cloudsY, opacity: heroOpacity }}
          className="absolute inset-0 z-5 pointer-events-none overflow-hidden will-change-transform"
        >
          <div className="hero-cloud-slow absolute top-[10%] left-[3%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-36 sm:w-44 md:w-52 opacity-25 dark:opacity-10 invert"
            />
          </div>
          <div className="hero-cloud-mid absolute top-[18%] left-1/2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-28 sm:w-36 md:w-44 opacity-20 dark:opacity-8 invert scale-x-[-1]"
            />
          </div>
          <div className="hero-cloud-fast absolute top-[6%] left-[70%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-20 sm:w-24 md:w-28 opacity-15 dark:opacity-6 invert"
            />
          </div>
          <div className="hero-cloud-slow absolute top-[28%] left-[25%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-24 sm:w-28 md:w-36 opacity-12 dark:opacity-5 invert scale-x-[-1]"
            />
          </div>
          <div className="hero-cloud-mid absolute top-[4%] left-[35%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/userhero/cloud.svg"
              alt=""
              width={279}
              height={181}
              className="w-16 sm:w-20 md:w-24 opacity-10 dark:opacity-4 invert"
            />
          </div>
        </motion.div>

        {/* Hero content */}
        <motion.div
          style={{ y: contentY, opacity: heroOpacity }}
          className="relative z-20 flex-1 flex flex-col items-center justify-center max-w-6xl mx-auto w-full px-6 pb-56 md:pb-64 text-center will-change-transform"
        >
          <p
            className="text-xs sm:text-sm font-semibold tracking-[0.2em] uppercase text-white/85 mb-4 drop-shadow"
            suppressHydrationWarning
          >
            {eyebrow}
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold tracking-[-1.2px] text-white leading-[1.05] max-w-4xl mx-auto drop-shadow-lg text-balance">
            {t('home.heroTitle1')}{' '}
            <span className="text-amber-200 drop-shadow-md">
              {t('home.heroTitle2')}
            </span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-white/80 max-w-2xl mx-auto leading-relaxed">
            {t('home.heroSubtitle')}
          </p>

          {/* Floating search card */}
          <div className="mt-10 max-w-3xl mx-auto w-full">
            <div className="flex items-center bg-white/95 dark:bg-jadwal-surface/95 backdrop-blur-xl border border-white/60 dark:border-jadwal-border-subtle rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)] overflow-hidden">
              <div className="hidden sm:block border-e border-jadwal-border-subtle min-w-[180px]">
                <CustomSelect
                  options={[
                    { value: '', label: t('home.allCategories') },
                    ...categories.map((c) => ({
                      value: c.slug,
                      label: localized(c, 'name'),
                    })),
                  ]}
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  placeholder={t('home.allCategories')}
                  className="w-full"
                />
              </div>
              <div className="flex-1 flex items-center gap-3 px-5">
                <Search
                  className="h-5 w-5 text-jadwal-text-muted shrink-0"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  placeholder={t('home.searchPlaceholder')}
                  className="w-full py-4 bg-transparent text-sm text-jadwal-text placeholder:text-jadwal-text-muted outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  aria-label={t('home.searchPlaceholder')}
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="hidden sm:flex items-center gap-2 m-2 px-6 py-3 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary text-sm font-semibold rounded-xl transition-colors"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {t('home.search')}
              </button>
              <button
                type="button"
                onClick={handleSearch}
                aria-label={t('home.search')}
                className="sm:hidden inline-grid place-items-center m-2 h-10 w-10 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary rounded-xl transition-colors"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Trust metrics */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 md:gap-10">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <ShieldCheck className="h-4 w-4 text-amber-300/90" />
              <span>
                <AnimatedCounter value={50} suffix="+" /> {t('home.verifiedPartners')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Star className="h-4 w-4 text-amber-300/90" />
              <span>
                <AnimatedCounter value={4.8} decimals={1} />/5 {t('home.averageRating')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Users className="h-4 w-4 text-amber-300/90" />
              <span>
                <AnimatedCounter value={2000} suffix="+" /> {t('home.bookings')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Headphones className="h-4 w-4 text-amber-300/90" />
              <span>{t('home.qatarSupport')}</span>
            </div>
          </div>
        </motion.div>

        {/* Waves (light) */}
        <div
          dir="ltr"
          className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none"
        >
          <svg
            className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z"
              fill="#87D6F7"
            />
          </svg>
        </div>
        <div
          dir="ltr"
          className="dark:hidden absolute bottom-0 inset-x-0 z-10 pointer-events-none"
        >
          <svg
            className="w-[200%] h-20 md:h-28 hero-wave"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z"
              fill="#3FC8F4"
            />
            <path
              d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z"
              fill="#00B9F1"
            />
          </svg>
        </div>

        {/* Waves (dark) */}
        <div
          dir="ltr"
          className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none"
        >
          <svg
            className="w-[200%] h-24 md:h-32 hero-wave-slow opacity-50"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,40 C200,0 400,80 600,40 C800,0 1000,80 1200,40 C1400,0 1600,80 1800,40 C2000,0 2200,80 2400,40 L2400,120 L0,120 Z"
              fill="#1e3a5f"
            />
          </svg>
        </div>
        <div
          dir="ltr"
          className="hidden dark:block absolute bottom-0 inset-x-0 z-10 pointer-events-none"
        >
          <svg
            className="w-[200%] h-20 md:h-28 hero-wave"
            viewBox="0 0 2400 120"
            preserveAspectRatio="none"
          >
            <path
              d="M0,30 C200,100 400,20 600,60 C800,100 1000,30 1200,70 C1400,100 1600,30 1800,60 C2000,100 2200,30 2400,70 L2400,120 L0,120 Z"
              fill="#1e3a5f"
            />
            <path
              d="M0,60 C150,90 350,50 600,80 C850,100 1050,50 1200,80 C1400,100 1600,50 1800,80 C2050,100 2200,60 2400,80 L2400,120 L0,120 Z"
              fill="#162d4a"
            />
          </svg>
        </div>

        {/* Boat — physical `left-1/2` so it stays centered on screen regardless of language direction */}
        <div className="absolute bottom-10 md:bottom-14 left-1/2 -translate-x-1/2 z-20 w-28 sm:w-36 md:w-44 hero-boat pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/userhero/boat.svg"
            alt=""
            width={144}
            height={72}
            className="w-full h-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.3)] dark:invert dark:opacity-80"
          />
        </div>
      </section>

      {/* Hero → content seam */}
      <div className="relative -mt-1 z-30">
        <div className="absolute inset-0 bg-linear-to-b from-[#87D6F7] to-jadwal-bg dark:from-[#0d1b2e] dark:to-jadwal-bg pointer-events-none" />
        <svg
          className="relative block w-full h-[40px] md:h-[60px]"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path
            d="M0,0 C150,80 350,0 600,40 C850,80 1050,0 1200,40 L1200,120 L0,120 Z"
            className="fill-jadwal-bg"
          />
        </svg>
      </div>

      {/* ─── Browse by category ─────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 md:py-16">
          <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text m-0 mb-6 md:mb-8">
            {t('home.browseByCategory', { defaultValue: 'Browse by category' })}
          </h2>
          <div className="flex gap-4 md:gap-6 overflow-x-auto pb-2 -mx-4 sm:mx-0 px-4 sm:px-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
            {categories.slice(0, 12).map((cat) => (
              <CategoryPill
                key={cat.id}
                label={localized(cat, 'name')}
                slug={cat.slug}
                image={cat.image}
              />
            ))}
            {categories.length === 0 ? (
              <div className="py-8 text-sm text-jadwal-text-faint">
                {t('home.noCategories', {
                  defaultValue: 'No categories available yet',
                })}
              </div>
            ) : null}
          </div>
        </div>
      </motion.section>

      {/* ─── Trending ─────────────────────────────────────────── */}
      <motion.section
        id="trending"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg scroll-mt-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={
              country
                ? `${t('home.trendingIn', { defaultValue: t('home.trending') })} ${localized(country, 'name')}`
                : t('home.trending')
            }
            seeAllHref="/explore"
            seeAllLabel={t('home.viewAll')}
            rtl={isRtl}
          />
          {trendingEvents.length > 0 ? (
            <div className="flex gap-4 md:gap-5 overflow-x-auto pb-2 -mx-4 sm:mx-0 px-4 sm:px-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {trendingEvents.map((event) => (
                <article
                  key={event.id}
                  className="group w-[280px] sm:w-[320px] shrink-0 flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal transition-shadow hover:shadow-jadwal-lg"
                >
                  {event.image ? (
                    <div className="h-[200px] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={event.image}
                        alt={localized(event, 'title')}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  ) : null}
                  <div className="p-[14px] flex flex-col gap-2">
                    <h3 className="font-semibold text-jadwal-text text-[15px] tracking-[-0.2px] line-clamp-2 text-balance">
                      {localized(event, 'title')}
                    </h3>
                    {event.description ? (
                      <p className="text-[13px] text-jadwal-text-muted leading-relaxed line-clamp-2">
                        {event.description}
                      </p>
                    ) : null}
                    {event.eventDate ? (
                      <div
                        className="mt-1 flex items-center gap-1.5 text-[12px] text-jadwal-text-faint"
                        suppressHydrationWarning
                      >
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {new Date(event.eventDate).toLocaleDateString(
                          isRtl ? 'ar-EG' : 'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noTrending', { defaultValue: 'No trending events yet' })}
            </div>
          )}
        </div>
      </motion.section>

      <PatternDivider />

      {/* ─── Featured (Handpicked for you) ──────────────────────── */}
      <motion.section
        id="featured"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg scroll-mt-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={t('home.featured')}
            seeAllHref="/explore"
            seeAllLabel={t('home.viewAll')}
            rtl={isRtl}
          />
          {featuredActivities.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {featuredActivities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} size="fill" />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noFeatured', {
                defaultValue: 'No featured activities yet',
              })}
            </div>
          )}
        </div>
      </motion.section>

      {/* ─── Near You ─────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg-soft"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <div className="flex items-end justify-between mb-5 gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text m-0 leading-[1.15]">
                {city
                  ? `${t('home.nearYou')} — ${localized(city, 'name')}`
                  : country
                    ? `${t('home.nearYou')} — ${localized(country, 'name')}`
                    : t('home.nearYou')}
              </h2>
              <p className="mt-1.5 text-sm text-jadwal-text-muted">
                {t('home.nearYouSubtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {locationStatus !== 'granted' && locationStatus !== 'requesting' ? (
                <button
                  type="button"
                  onClick={requestLocation}
                  className="hidden sm:inline-flex items-center gap-1.5 px-4 h-10 text-sm font-semibold text-jadwal-on-primary bg-jadwal-primary hover:bg-jadwal-primary-hover rounded-xl transition-colors"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {t('home.findNearMe')}
                </button>
              ) : null}
              {locationStatus === 'requesting' ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-4 h-10 text-sm text-jadwal-text-muted">
                  <MapPin className="h-4 w-4 animate-pulse" aria-hidden="true" />
                  {t('common.loading')}
                </span>
              ) : null}
              {locationStatus === 'denied' ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-jadwal-warning">
                  {t('home.locationDenied')}
                </span>
              ) : null}
              <Link
                href="/explore"
                className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-jadwal-primary hover:underline"
              >
                {t('home.viewAll')}
              </Link>
            </div>
          </div>

          {nearYouActivities.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {nearYouActivities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} size="fill" />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface h-60 flex items-center justify-center">
              <div className="text-center">
                <MapPin
                  className="h-10 w-10 text-jadwal-text-faint mx-auto mb-3"
                  aria-hidden="true"
                />
                <p className="text-jadwal-text-muted font-medium">
                  {isDetecting
                    ? t('home.detectingLocation', {
                        defaultValue: 'Detecting your location...',
                      })
                    : t('home.noNearYou', {
                        defaultValue: 'No activities in your area yet',
                      })}
                </p>
                <p className="text-xs text-jadwal-text-faint mt-1">
                  {t('home.checkBackSoon', {
                    defaultValue: 'Check back soon for new experiences',
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.section>

      {/* ─── Why Jadwal (Trust strip) ─────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-surface-muted border-y border-jadwal-border-subtle"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 md:py-14">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {[
              {
                icon: ShieldCheck,
                titleKey: 'home.verifiedPartners',
                descKey: 'home.verifiedPartnersDesc',
                gold: false,
              },
              {
                icon: Zap,
                titleKey: 'home.easyCancellation',
                descKey: 'home.easyCancellationDesc',
                gold: false,
              },
              {
                icon: Gift,
                titleKey: 'home.instantConfirmation',
                descKey: 'home.instantConfirmationDesc',
                gold: true,
              },
            ].map((item) => (
              <div key={item.titleKey} className="flex items-start gap-3.5">
                <div
                  className={
                    'grid h-11 w-11 place-items-center rounded-xl shrink-0 ' +
                    (item.gold
                      ? 'bg-jadwal-accent-soft text-jadwal-accent'
                      : 'bg-sky-500/10 text-jadwal-primary')
                  }
                >
                  <item.icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-jadwal-text tracking-[-0.2px] mb-0.5">
                    {t(item.titleKey)}
                  </div>
                  <div className="text-[13px] text-jadwal-text-muted leading-relaxed">
                    {t(item.descKey)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ─── CTA ────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-linear-to-br from-sky-600 to-indigo-700" />
        <div
          aria-hidden="true"
          className="absolute top-0 -inset-s-20 w-80 h-80 bg-white/5 rounded-full blur-[80px]"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-0 -inset-e-20 w-80 h-80 bg-white/5 rounded-full blur-[80px]"
        />
        <div className="relative max-w-7xl mx-auto px-6 py-16 md:py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-[-0.8px] text-white max-w-2xl mx-auto text-balance">
            {t('home.ctaTitle')}
          </h2>
          <p className="mt-4 text-base md:text-lg text-blue-100 max-w-xl mx-auto">
            {t('home.ctaSubtitle')}
          </p>
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 mt-8 px-8 py-4 bg-white text-jadwal-primary font-bold rounded-2xl hover:bg-sky-50 transition-colors shadow-xl shadow-blue-900/30"
          >
            {t('home.getStarted')}
          </Link>
        </div>
      </motion.section>

      <Footer />
    </div>
  );
}
