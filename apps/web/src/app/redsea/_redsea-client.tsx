'use client';

/**
 * Interactive / animated body of the bespoke "Red Sea Escape" landing page.
 * Holds: Framer-Motion scroll reveals (whileInView) and the mobile sticky CTA
 * that slides up once the hero has scrolled out of view.
 *
 * Fonts (Playfair_Display + Noto_Naskh_Arabic) are loaded in page.tsx via
 * next/font and applied as the `--font-redsea-serif` / `--font-redsea-ar` CSS
 * variables on the page wrapper, so this component just references them with
 * `font-[family-name:var(--font-redsea-serif)]`.
 */

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { fbTrack } from '@/lib/fb-pixel';

const WA = 'https://wa.me/97477499399?text=RED%20SEA';

// Meta Pixel conversion for the WhatsApp CTA — the page's primary goal is a
// WhatsApp inquiry, so a click is a Lead. No-ops unless the pixel loaded after
// cookie consent (see lib/fb-pixel.ts). Opens in a new tab, so the beacon has
// time to send from the still-open page.
function trackWhatsappLead() {
  fbTrack('Lead', { content_name: 'Red Sea Escape', content_category: 'redsea' });
}

/** Shared scroll-reveal wrapper — matches the .reveal CSS (fade + rise). */
function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const serif = 'font-[family-name:var(--font-redsea-serif)]';
const arFont = 'font-[family-name:var(--font-redsea-ar)]';

function Eyebrow({ lat, ar }: { lat: string; ar: string }) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-[0.7em] gap-y-1 text-[clamp(11px,1.4vw,13px)] font-bold uppercase text-[#B8965A]">
      <span className="ps-[0.32em] tracking-[0.32em]">{lat}</span>
      <span className="opacity-70">·</span>
      <span className={`${arFont} text-[1.35em] font-medium tracking-normal`} dir="rtl">
        {ar}
      </span>
    </p>
  );
}

function GoldButton({ className = '' }: { className?: string }) {
  return (
    <a
      href={WA}
      target="_blank"
      rel="noopener noreferrer"
      onClick={trackWhatsappLead}
      className={`inline-flex items-center gap-[0.7em] bg-[#B8965A] px-8 py-[17px] text-sm font-bold uppercase tracking-[0.12em] text-white transition-[transform,background] duration-300 hover:-translate-y-0.5 hover:bg-[#D4AF6E] ${className}`}
    >
      <Sparkles className="h-[1.15em] w-[1.15em]" aria-hidden="true" /> DM us “Red Sea”
    </a>
  );
}

const TIERS = [
  { name: 'Essential', room: 'Classic Resort View', price: 'QAR 12,060', voucher: 'SAR 1,000', feature: false },
  { name: 'Premier', room: 'Classic Lagoon View', price: 'QAR 13,000', voucher: 'SAR 1,500', feature: false },
  { name: 'Signature', room: 'Classic Sea View', price: 'QAR 13,500', voucher: 'SAR 1,500', feature: true },
  { name: 'Iconic', room: 'Classic Beachfront', price: 'QAR 15,200', voucher: 'SAR 2,500', feature: false },
];

const DAYS = [
  {
    k: 'Underwater',
    t: 'Beneath the surface',
    by: 'with Galaxea',
    items: [
      ['Outer-reef snorkelling', 'SAR 650'],
      ['Guided double dive', 'SAR 1,400'],
      ['Private boat charter', 'SAR 2,000/hr'],
    ],
  },
  {
    k: 'On the Water',
    t: 'At your own pace',
    by: 'with WAMA',
    items: [
      ['Sunrise SUP yoga', 'SAR 250'],
      ['Seabob sea scooter', 'SAR 650'],
      ['E-surf lesson', 'SAR 850'],
    ],
  },
  {
    k: 'On Land',
    t: 'Desert & sky',
    by: 'with Akun',
    items: [
      ['Wadi Marakh hike', 'SAR 350'],
      ['The Action Pass', 'SAR 900'],
      ['Arabian astronomy night', 'SAR 700'],
    ],
  },
];

const INCLUDED: [string, string][] = [
  ['Three nights', ' at InterContinental The Red Sea, on Shura Island'],
  ['Daily breakfast', ' for two'],
  ['Private airport transfers', ', Red Sea International ↔ Shura Island'],
  ['A curated experience credit', ', designed around your taste'],
  ['A 24/7 bilingual concierge', ', from arrival to departure'],
];

const DETAILS = [
  {
    h: 'Flights & visa',
    body: (
      <>
        Qatar Airways flies Doha&nbsp;→&nbsp;The Red Sea direct, roughly{' '}
        <b className="font-semibold text-[#0F1419]">QAR 1,400 return</b> per person. Flights and visa arranged on
        request.
      </>
    ),
  },
  {
    h: 'Booking',
    body: (
      <>
        A <b className="font-semibold text-[#0F1419]">50% deposit</b> confirms your dates. The balance is due seven
        days before arrival.
      </>
    ),
  },
  {
    h: 'Cancellation',
    body: (
      <>
        <b className="font-semibold text-[#0F1419]">Free</b> up to seven days before arrival. Experiences follow the
        resort’s own flexible terms.
      </>
    ),
  },
];

export default function RedSeaClient() {
  const [showSticky, setShowSticky] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const io = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* ===================== HERO ===================== */}
      <header
        ref={heroRef}
        className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-[#1A2230] px-0 pb-24 pt-[120px] text-center text-[#FAF7F2]"
      >
        <Image
          src="/redsea/redsea-1.webp"
          alt="InterContinental The Red Sea — turquoise sea off Shura Island"
          fill
          priority
          sizes="100vw"
          // Served directly (no on-the-fly AVIF re-encode). The source is an
          // already-optimized 134KB WebP, so Next's optimizer only added a slow
          // first-request AVIF encode (blank hero until done → a refresh then
          // showed the cached variant) for negligible byte savings. Direct +
          // priority-preloaded + Cloudflare-cached as a static asset = instant,
          // reliable first paint. The blur placeholder fills the sub-second wait.
          unoptimized
          placeholder="blur"
          blurDataURL="data:image/webp;base64,UklGRmIAAABXRUJQVlA4IFYAAADwAQCdASoQAAsAA4BaJbACdAEMV6mMNAAA/kEsITIlDMAInddVuhlmajApNI3hyqf6n0DE/WDz5W2kg/5IxZ+CdNRcUeHEXOYCqDOvDM1p9ub+PoAAAA=="
          className="object-cover object-[center_38%]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#141A26]/[0.78] via-[#141A26]/[0.38] to-[#141A26]/[0.88]" />
        <div className="pointer-events-none absolute inset-[clamp(16px,3vw,30px)] border-[1.5px] border-[#B8965A]/55" />

        <div className="relative max-w-[840px] px-[26px]">
          <Eyebrow lat="Jadwal Presents" ar="جدول يقدّم" />
          <h1 className={`${serif} mt-[0.32em] text-[clamp(46px,11vw,104px)] font-semibold leading-none tracking-[-0.015em]`}>
            The Red Sea <span className="italic font-medium text-[#D4AF6E]">Escape.</span>
          </h1>
          <p className={`${arFont} mt-[0.45em] text-[clamp(22px,5vw,40px)] font-medium leading-[1.7] text-[#FAF7F2]/95`} dir="rtl">
            رحلة البحر الأحمر.
          </p>
          <p className="mt-[30px] text-[clamp(13px,2vw,16px)] font-medium uppercase tracking-[0.12em] text-[#FAF7F2]/80">
            Three nights · Direct from Doha · Curated by Jadwal
          </p>
          <div className="mt-[42px] flex flex-col items-center gap-4">
            <GoldButton />
            <p className="text-[13px] tracking-[0.06em] text-[#FAF7F2]/60">
              or message{' '}
              <a href={WA} target="_blank" rel="noopener noreferrer" className="border-b border-[#B8965A]/50 text-[#FAF7F2]/85">
                +974 7749 9399
              </a>
            </p>
          </div>
        </div>

        <div className="absolute bottom-[34px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[#FAF7F2]/55">
          <span className="block h-[34px] w-px bg-gradient-to-b from-[#B8965A]/70 to-transparent" />
          Discover
        </div>
      </header>

      {/* ===================== PROPOSITION ===================== */}
      <section className="bg-[#FAF7F2] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)]">
        <Reveal className="mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <Eyebrow lat="The Idea" ar="الفكرة" />
            <h2 className={`${serif} mt-5 text-[clamp(30px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em]`}>
              Tell us what you love.
              <br />
              <span className="italic font-medium text-[#B8965A]">We design the rest.</span>
            </h2>
            <p className={`${arFont} mx-auto mt-[14px] text-[clamp(19px,3.6vw,30px)] font-medium leading-[1.7] text-[#4A4A4A]`} dir="rtl">
              أخبرنا بما تحب · ونتولّى الباقي
            </p>
            <p className="mx-auto mt-[30px] max-w-[620px] text-[clamp(16px,2.3vw,19px)] leading-[1.7] text-[#4A4A4A]">
              A private-island resort, a turquoise sea few have reached, and days shaped entirely around you — diving,
              stillness, desert, or all three. You choose the feeling. We arrange every detail.
            </p>
          </div>
          <div className="mt-[54px] flex flex-col flex-wrap border-y border-[#E5E5E5] sm:flex-row sm:justify-center">
            {[
              ['2.5', ' hrs', 'Direct flight'],
              ['3', ' / week', 'From Doha · Sun · Tue · Thu'],
              ['3', '', 'Nights · Shura Island'],
            ].map(([n, small, label], i) => (
              <div
                key={label}
                className={`min-w-[140px] flex-1 px-[18px] py-[30px] text-center ${i > 0 ? 'border-t border-[#E5E5E5] sm:border-l sm:border-t-0' : ''}`}
              >
                <div className={`${serif} text-[clamp(34px,5vw,46px)] font-semibold leading-none text-[#1A2230]`}>
                  {n}
                  {small ? <small className="text-[0.5em]">{small}</small> : null}
                </div>
                <div className="mt-3 text-[12px] uppercase tracking-[0.16em] text-[#6B6B6B]">{label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===================== INCLUDED ===================== */}
      <section className="bg-[#1A2230] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)] text-[#FAF7F2]">
        <Reveal className="mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <Eyebrow lat="Every Escape Includes" ar="تشمل كل رحلة" />
            <h2 className={`${serif} mt-5 text-[clamp(30px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em] text-white`}>
              Arrive. Everything else is handled.
            </h2>
          </div>
          <div className="mx-auto mt-[52px] max-w-[760px]">
            {INCLUDED.map(([bold, rest], i) => (
              <div
                key={bold}
                className={`flex items-baseline gap-[22px] border-b border-white/10 py-6 ${i === 0 ? 'border-t' : ''}`}
              >
                <span className={`${serif} flex-none translate-y-0.5 text-[20px] leading-none text-[#D4AF6E]`}>—</span>
                <span className="text-[clamp(16px,2.3vw,19px)] text-[#FAF7F2]/90">
                  <b className="font-semibold text-white">{bold}</b>
                  {rest}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===================== TIERS ===================== */}
      <section id="views" className="bg-[#FAF7F2] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)]">
        <Reveal className="mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <Eyebrow lat="Choose Your View" ar="اختر إطلالتك" />
            <h2 className={`${serif} mt-5 text-[clamp(30px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em]`}>
              Four ways to wake up.
            </h2>
            <p className="mt-[18px] text-[13px] uppercase tracking-[0.14em] text-[#6B6B6B]">
              Per couple · Three nights · Breakfast, transfers &amp; concierge included
            </p>
          </div>
          <div className="mt-[50px] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`relative flex flex-col p-[34px_26px_30px] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-24px_rgba(26,34,48,0.35)] ${
                  t.feature ? 'border-[1.5px] border-[#B8965A] bg-[#F4EFE6]' : 'border border-[#E5E5E5] bg-white'
                }`}
              >
                {t.feature ? (
                  <div className="absolute -top-[11px] left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#B8965A] px-[14px] py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                    Most Chosen
                  </div>
                ) : null}
                <div className={`${serif} text-[26px] font-semibold text-[#1A2230]`}>{t.name}</div>
                <div className="mt-1.5 min-h-[34px] text-[13px] tracking-[0.06em] text-[#6B6B6B]">{t.room}</div>
                <div className={`${serif} mt-5 text-[30px] font-semibold leading-none text-[#0F1419]`}>{t.price}</div>
                <div className="mt-2 text-[12px] uppercase tracking-[0.12em] text-[#6B6B6B]">Per couple · 3 nights</div>
                <div className="mt-[22px] border-t border-[#E5E5E5] pt-[18px] text-[13.5px] leading-[1.5] text-[#4A4A4A]">
                  Experience credit <b className="font-bold text-[#B8965A]">{t.voucher}</b>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===================== DESIGN YOUR DAYS ===================== */}
      <section className="bg-[#141A26] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)] text-[#FAF7F2]">
        <Reveal className="mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <Eyebrow lat="Design Your Days" ar="صمّم أيامك" />
            <h2 className={`${serif} mt-5 text-[clamp(30px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em] text-white`}>
              From the reef to the stars.
            </h2>
            <p className="mx-auto mt-[26px] max-w-[600px] text-[clamp(15px,2.1vw,17px)] text-[#FAF7F2]/70">
              Choose what moves you. We book every experience through the resort concierge — you simply arrive.
            </p>
          </div>
          <div className="mt-[56px] grid grid-cols-1 gap-px bg-white/10 lg:grid-cols-3">
            {DAYS.map((d) => (
              <div key={d.k} className="bg-[#141A26] p-[38px_30px]">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#D4AF6E]">{d.k}</div>
                <div className={`${serif} mt-3 text-[24px] font-semibold text-white`}>{d.t}</div>
                <div className="mt-1 text-[12px] tracking-[0.04em] text-[#6B6B6B]">{d.by}</div>
                <ul className="mt-[22px]">
                  {d.items.map(([name, price], i) => (
                    <li
                      key={name}
                      className={`flex justify-between gap-[14px] py-[11px] text-[15px] text-[#FAF7F2]/85 ${
                        i < d.items.length - 1 ? 'border-b border-white/[0.08]' : ''
                      }`}
                    >
                      <span>{name}</span>
                      <span className="self-center whitespace-nowrap text-[12.5px] tracking-[0.04em] text-[#D4AF6E]">{price}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===================== DETAILS ===================== */}
      <section className="bg-[#F4EFE6] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)]">
        <Reveal className="mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <Eyebrow lat="Good to Know" ar="معلومات مهمة" />
            <h2 className={`${serif} mt-5 text-[clamp(30px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em]`}>
              The fine print, kept short.
            </h2>
          </div>
          <div className="mt-[50px] grid grid-cols-1 gap-[30px] lg:grid-cols-3">
            {DETAILS.map((d) => (
              <div key={d.h}>
                <h3 className={`${serif} text-[21px] font-semibold text-[#1A2230]`}>{d.h}</h3>
                <div className="mt-[14px] mb-4 h-px w-9 bg-[#B8965A]" />
                <p className="text-[15px] leading-[1.65] text-[#4A4A4A]">{d.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===================== CLOSING CTA ===================== */}
      <section className="relative overflow-hidden bg-[#1A2230] px-[clamp(22px,5vw,56px)] py-[clamp(64px,9vw,112px)] text-center text-[#FAF7F2]">
        <Image
          src="/redsea/redsea-1.webp"
          alt=""
          aria-hidden="true"
          fill
          sizes="100vw"
          // Same static WebP as the hero — serve it directly too (decorative
          // faded backdrop) so it doesn't trigger a second slow AVIF encode.
          unoptimized
          className="object-cover opacity-[0.16] saturate-[0.7]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1A2230]/[0.86] to-[#141A26]/[0.94]" />
        <Reveal className="relative mx-auto max-w-[680px]">
          <Eyebrow lat="Ready to Escape" ar="جاهز للرحلة" />
          <h2 className={`${serif} mt-[22px] text-[clamp(30px,5vw,46px)] font-semibold leading-[1.1]`}>
            Start with two words.
            <span className={`${serif} my-[0.1em] block text-[clamp(48px,11vw,90px)] font-semibold italic tracking-[0.01em] text-[#D4AF6E]`}>
              “Red Sea.”
            </span>
          </h2>
          <p className="mx-auto mb-[38px] max-w-[480px] text-[clamp(15px,2.2vw,18px)] leading-[1.7] text-[#FAF7F2]/80">
            Send us a message and tell us what you love. We’ll design the rest — and we reply quickly.
          </p>
          <GoldButton />
          <div className="mt-[40px] flex flex-col flex-wrap justify-center gap-3 text-[13px] tracking-[0.08em] text-[#FAF7F2]/70 sm:flex-row sm:gap-x-[26px]">
            <a href="https://instagram.com/jadwal.qtr" target="_blank" rel="noopener noreferrer" className="text-[#FAF7F2]/90 hover:text-[#D4AF6E]">
              @jadwal.qtr
            </a>
            <a href={WA} target="_blank" rel="noopener noreferrer" className="text-[#FAF7F2]/90 hover:text-[#D4AF6E]">
              WhatsApp +974 7749 9399
            </a>
            <a href="https://jadwal.qa" target="_blank" rel="noopener noreferrer" className="text-[#FAF7F2]/90 hover:text-[#D4AF6E]">
              jadwal.qa
            </a>
          </div>
        </Reveal>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="bg-[#141A26] px-[clamp(22px,5vw,56px)] py-10 text-center text-[#FAF7F2]/50">
        <div className="flex flex-col items-center gap-2">
          <div className={`${serif} text-[20px] uppercase tracking-[0.18em] text-[#D4AF6E]`}>Al Jadwal</div>
          <small className="text-[12px] leading-[1.6] tracking-[0.06em]">
            Licensed travel curation · Qatar &nbsp;·&nbsp; jadwal.qa
          </small>
          <small className="text-[12px] leading-[1.6] tracking-[0.06em]">
            The Red Sea, Saudi Arabia · In partnership with InterContinental The Red Sea
          </small>
        </div>
      </footer>

      {/* sticky mobile cta — slides up once the hero scrolls out of view */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-[#B8965A]/35 bg-[#141A26]/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-300 sm:hidden ${
          showSticky ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <GoldButton className="w-full justify-center !py-4" />
      </div>
    </>
  );
}
