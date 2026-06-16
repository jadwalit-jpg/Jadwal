// Shared helpers for vendor activity availability blocks — used by the block
// manager (activity edit page) and the read-only summary (activities list).

export interface Block {
  id: string;
  blockStart: string; // ISO (UTC)
  blockEnd: string;   // ISO (UTC), exclusive
  createdAt?: string;
}

export type DisplayItem =
  | { kind: 'single'; block: Block }
  | { kind: 'series'; key: string; weekday: string; first: string; last: string; count: number; ids: string[] };

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Render a stored UTC interval back as the date(s)/time the vendor picked.
// Blocks are stored in UTC (built from the picked Y-M-D + H:M), so we read the
// UTC components to avoid a local-timezone shift in the display.
export function formatBlock(b: Block): string {
  const s = new Date(b.blockStart);
  const e = new Date(b.blockEnd);
  const ymd = (x: Date) =>
    `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  const hm = (x: Date) =>
    `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  const startDay = ymd(s);
  const wholeDay = hm(s) === '00:00' && hm(e) === '00:00';
  if (wholeDay) {
    // end is the exclusive next-midnight → last blocked day = end − 1 day.
    const lastDay = ymd(new Date(e.getTime() - 24 * 60 * 60 * 1000));
    return lastDay === startDay ? startDay : `${startDay} → ${lastDay}`;
  }
  // A 60-min window is a single locked START slot — show just the start time
  // (only a booking that STARTS here is blocked), not a "12:00–13:00" range.
  if (e.getTime() - s.getTime() === 60 * 60 * 1000) {
    return `${startDay} · ${hm(s)}`;
  }
  return `${startDay} · ${hm(s)}–${hm(e)}`;
}

function ymdUTC(iso: string): string {
  const x = new Date(iso);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

// Collapse the recurring whole-day occurrences (each stored as its own 1-day
// row) into one "Every <weekday>" series so the list shows a span, not 50 rows.
// One-off ranges and time-window blocks stay individual.
export function buildDisplay(blocks: Block[]): DisplayItem[] {
  const DAY = 86400000;
  const groupable: Block[] = []; // exactly-one-whole-day blocks → group by weekday
  const singles: Block[] = [];   // time windows + multi-day ranges → individual
  for (const b of blocks) {
    const s = new Date(b.blockStart), e = new Date(b.blockEnd);
    const midnight = (x: Date) => x.getUTCHours() === 0 && x.getUTCMinutes() === 0;
    const oneDay = midnight(s) && midnight(e) && e.getTime() - s.getTime() === DAY;
    if (oneDay) groupable.push(b); else singles.push(b);
  }
  const byWeekday = new Map<number, Block[]>();
  for (const b of groupable) {
    const wd = new Date(b.blockStart).getUTCDay();
    const arr = byWeekday.get(wd) ?? [];
    arr.push(b);
    byWeekday.set(wd, arr);
  }
  const items: DisplayItem[] = [];
  for (const b of singles) items.push({ kind: 'single', block: b });
  for (const [wd, list] of byWeekday) {
    if (list.length === 1) { items.push({ kind: 'single', block: list[0] }); continue; }
    list.sort((a, b) => (a.blockStart < b.blockStart ? -1 : 1));
    items.push({
      kind: 'series', key: `wd-${wd}`, weekday: WEEKDAY_NAMES[wd],
      first: ymdUTC(list[0].blockStart), last: ymdUTC(list[list.length - 1].blockStart),
      count: list.length, ids: list.map((x) => x.id),
    });
  }
  const sortKey = (it: DisplayItem) => (it.kind === 'single' ? it.block.blockStart : it.first);
  items.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  return items;
}
