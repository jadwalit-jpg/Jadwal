'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function formatDisplay(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    const d = from ? new Date(from) : new Date();
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = from ? new Date(from) : new Date();
    return d.getMonth();
  });
  const [picking, setPicking] = useState<'from' | 'to'>('from');
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const prevMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 0) { setViewYear(y => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 11) { setViewYear(y => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const handleDayClick = useCallback((dateStr: string) => {
    if (picking === 'from') {
      onChange(dateStr, to && dateStr <= to ? to : '');
      setPicking('to');
    } else {
      if (from && dateStr < from) {
        // Clicked before "from" — reset
        onChange(dateStr, '');
        setPicking('to');
      } else {
        onChange(from, dateStr);
        setPicking('from');
        setOpen(false);
      }
    }
  }, [picking, from, to, onChange]);

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days: { day: number; dateStr: string }[] = [];

    for (let i = 0; i < firstDay; i++) days.push({ day: 0, dateStr: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, dateStr: toYMD(viewYear, viewMonth, d) });
    }
    return days;
  }, [viewYear, viewMonth]);

  const today = useMemo(() => {
    const now = new Date();
    return toYMD(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const hasSelection = from || to;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium border transition-all ${
          hasSelection
            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300'
            : 'bg-white dark:bg-slate-900/50 border-gray-200 dark:border-slate-800 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-700'
        }`}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        {hasSelection ? (
          <span>{formatDisplay(from)}{to ? ` — ${formatDisplay(to)}` : ' — ...'}</span>
        ) : (
          <span>Date range</span>
        )}
      </button>

      {/* Clear button */}
      {hasSelection && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange('', ''); setPicking('from'); }}
          className="ms-1.5 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-500 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Dropdown calendar */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 end-0 z-50 w-72 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl shadow-gray-200/50 dark:shadow-none p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                <ChevronLeft className="h-4 w-4 text-gray-500 dark:text-slate-400" />
              </button>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                <ChevronRight className="h-4 w-4 text-gray-500 dark:text-slate-400" />
              </button>
            </div>

            {/* Picking indicator */}
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setPicking('from')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide text-center transition-all ${
                  picking === 'from'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-400 dark:text-slate-500'
                }`}
              >
                From: {from ? formatDisplay(from) : '—'}
              </button>
              <button
                type="button"
                onClick={() => setPicking('to')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide text-center transition-all ${
                  picking === 'to'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-400 dark:text-slate-500'
                }`}
              >
                To: {to ? formatDisplay(to) : '—'}
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-gray-400 dark:text-slate-500 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {calendarDays.map((item, i) => {
                if (item.day === 0) return <div key={`empty-${i}`} />;

                const isToday = item.dateStr === today;
                const isFrom = item.dateStr === from;
                const isTo = item.dateStr === to;
                const isInRange = from && to && item.dateStr > from && item.dateStr < to;
                const isFuture = item.dateStr > today;

                return (
                  <button
                    key={item.dateStr}
                    type="button"
                    onClick={() => handleDayClick(item.dateStr)}
                    disabled={isFuture}
                    className={`h-8 w-full text-xs font-medium rounded-lg transition-all ${
                      isFrom || isTo
                        ? 'bg-blue-600 text-white'
                        : isInRange
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : isToday
                        ? 'text-blue-600 dark:text-blue-400 font-bold'
                        : isFuture
                        ? 'text-gray-200 dark:text-slate-700 cursor-not-allowed'
                        : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {item.day}
                  </button>
                );
              })}
            </div>

            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
              {[
                { label: 'Today', days: 0 },
                { label: '7d', days: 7 },
                { label: '30d', days: 30 },
                { label: '90d', days: 90 },
              ].map(preset => {
                const toDate = new Date();
                const fromDate = new Date();
                fromDate.setDate(fromDate.getDate() - preset.days);
                const f = toYMD(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
                const t = toYMD(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => { onChange(f, t); setOpen(false); }}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
