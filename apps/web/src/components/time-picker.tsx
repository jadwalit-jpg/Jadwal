'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, ChevronUp, ChevronDown } from 'lucide-react';

interface TimePickerProps {
  value: string; // "HH:mm" or ""
  onChange: (value: string) => void;
  hasError?: boolean;
  placeholder?: string;
  direction?: 'up' | 'down';
}

export default function TimePicker({ value, onChange, hasError, placeholder = 'Select time', direction = 'down' }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = value ? value.split(':').map(Number) : [null, null];
  const [hour, minute] = parsed;
  const isPM = hour !== null && hour >= 12;
  const displayHour = hour !== null ? (hour === 0 ? 12 : hour > 12 ? hour - 12 : hour) : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const buildTime = useCallback((h: number, m: number) => {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm}`;
  }, []);

  const setHour24 = (h12: number, pm: boolean) => {
    let h24 = h12;
    if (pm && h12 !== 12) h24 = h12 + 12;
    if (!pm && h12 === 12) h24 = 0;
    onChange(buildTime(h24, minute ?? 0));
  };

  const setMinuteVal = (m: number) => {
    onChange(buildTime(hour ?? 12, m));
  };

  const togglePeriod = () => {
    if (hour === null) {
      onChange(buildTime(12, 0));
      return;
    }
    const newHour = isPM ? hour - 12 : hour + 12;
    onChange(buildTime(newHour < 0 ? 0 : newHour > 23 ? 23 : newHour, minute ?? 0));
  };

  const incrementHour = () => {
    const current = displayHour ?? 12;
    const next = current >= 12 ? 1 : current + 1;
    setHour24(next, isPM);
  };

  const decrementHour = () => {
    const current = displayHour ?? 12;
    const next = current <= 1 ? 12 : current - 1;
    setHour24(next, isPM);
  };

  const incrementMinute = () => {
    const current = minute ?? 0;
    const next = current >= 55 ? 0 : current + 5;
    setMinuteVal(next);
  };

  const decrementMinute = () => {
    const current = minute ?? 0;
    const next = current <= 0 ? 55 : current - 5;
    setMinuteVal(next);
  };

  const formatDisplay = () => {
    if (hour === null) return '';
    const h = displayHour;
    const m = String(minute ?? 0).padStart(2, '0');
    const period = isPM ? 'PM' : 'AM';
    return `${h}:${m} ${period}`;
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors text-start ${
          hasError
            ? 'border-red-400 focus:ring-red-400/20'
            : open
              ? 'border-[#1d4f35]/50 ring-2 ring-[#1d4f35]/20'
              : 'border-gray-200 dark:border-slate-700 focus:ring-[#1d4f35]/20 focus:border-[#1d4f35]/50'
        }`}
      >
        <span className={value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-slate-500'}>
          {value ? formatDisplay() : placeholder}
        </span>
        <Clock className="h-4 w-4 text-gray-400 dark:text-slate-500 shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={`absolute z-50 inset-s-0 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl shadow-black/10 dark:shadow-black/30 p-5 w-[260px] ${direction === 'up' ? 'bottom-full mb-2' : 'mt-2'}`}>
          <div className="flex items-center justify-center gap-3">
            {/* Hour spinner */}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={incrementHour}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <div className="w-16 h-14 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
                <span className="text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
                  {displayHour !== null ? String(displayHour).padStart(2, '0') : '--'}
                </span>
              </div>
              <button
                type="button"
                onClick={decrementHour}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider">Hour</span>
            </div>

            {/* Separator */}
            <span className="text-2xl font-bold text-gray-300 dark:text-slate-600 mb-6">:</span>

            {/* Minute spinner */}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={incrementMinute}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <div className="w-16 h-14 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
                <span className="text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
                  {minute !== null ? String(minute).padStart(2, '0') : '--'}
                </span>
              </div>
              <button
                type="button"
                onClick={decrementMinute}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider">Min</span>
            </div>

            {/* AM/PM toggle */}
            <div className="flex flex-col items-center gap-1 ms-1">
              <button
                type="button"
                onClick={togglePeriod}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <div className="w-14 h-14 flex items-center justify-center rounded-xl bg-[#1d4f35]/10 dark:bg-[#1d4f35]/20 border border-[#1d4f35]/30">
                <span className="text-lg font-bold text-[#1d4f35] dark:text-emerald-400">
                  {hour !== null ? (isPM ? 'PM' : 'AM') : '--'}
                </span>
              </div>
              <button
                type="button"
                onClick={togglePeriod}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider">Period</span>
            </div>
          </div>

          {/* Quick presets */}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700">
            <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Quick Select</p>
            <div className="flex flex-wrap gap-1.5">
              {['06:00', '08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'].map(t => {
                const [h] = t.split(':').map(Number);
                const label = `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`;
                const isActive = value === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { onChange(t); setOpen(false); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-[#1d4f35] text-white'
                        : 'bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
