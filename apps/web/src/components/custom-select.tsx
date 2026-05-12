'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledPlaceholder?: string;
  className?: string;
  /**
   * When true, omits the "clear" placeholder row at the top of the dropdown.
   * Use for dropdowns where an empty value is not meaningful (e.g., a
   * sort direction that always has a selected state).
   */
  required?: boolean;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  disabledPlaceholder,
  className = '',
  required = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position the fixed dropdown relative to the button
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dropdownWidth = Math.max(rect.width, 200);
    const dropdownHeight = 280;

    // Vertical: open upward if not enough space below
    const spaceBelow = viewportHeight - rect.bottom;
    const openUpward = spaceBelow < dropdownHeight && rect.top > dropdownHeight;

    // Horizontal: align right if dropdown would overflow right edge
    const wouldOverflowRight = rect.left + dropdownWidth > viewportWidth - 8;

    setDropdownStyle({
      position: 'fixed',
      width: dropdownWidth,
      zIndex: 9999,
      ...(wouldOverflowRight
        ? { right: viewportWidth - rect.right }
        : { left: rect.left }),
      ...(openUpward
        ? { bottom: viewportHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, []);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setOpen(o => !o);
  }, [disabled, updatePosition]);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    const closeOnScroll = (e: Event) => {
      // Don't close if scrolling inside the dropdown itself
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const selectedLabel = useMemo(
    () => options.find(o => o.value === value)?.label ?? '',
    [options, value],
  );

  const grouped = useMemo(() => {
    const map: { group: string | null; items: SelectOption[] }[] = [];
    for (const opt of options) {
      if (opt.value === '') continue; // skip — placeholder row handles empty value
      const g = opt.group ?? null;
      const existing = map.find(m => m.group === g);
      if (existing) existing.items.push(opt);
      else map.push({ group: g, items: [opt] });
    }
    return map;
  }, [options]);

  const displayText = disabled && disabledPlaceholder
    ? disabledPlaceholder
    : value ? selectedLabel : placeholder;

  const dropdown = (
    <>
      {open && !disabled && (
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl shadow-gray-200/60 dark:shadow-black/40 overflow-hidden animate-[dropdownIn_0.15s_ease-out]"
        >
          <div className="max-h-64 overflow-y-auto py-1.5">
            {!required && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-sky-50 dark:hover:bg-slate-700/60
                  ${!value ? 'text-sky-600 dark:text-blue-400 font-medium' : 'text-gray-400 dark:text-slate-500'}`}
              >
                {placeholder}
                {!value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )}

            {grouped.map(({ group, items }) => (
              <div key={group ?? '__ungrouped'}>
                {group && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
                    {group}
                  </div>
                )}
                {items.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onChange(opt.value); setOpen(false); }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-sky-50 dark:hover:bg-slate-700/60
                      ${group ? 'ps-6' : ''}
                      ${value === opt.value ? 'text-sky-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-slate-300'}`}
                  >
                    {group ? (
                      <span className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" />
                        {opt.label}
                      </span>
                    ) : opt.label}
                    {value === opt.value && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-sm outline-none transition-colors
          ${disabled
            ? 'border-gray-200 dark:border-slate-700 opacity-50 cursor-not-allowed text-gray-400 dark:text-slate-500'
            : open
              ? 'border-sky-400 dark:border-blue-500 text-gray-900 dark:text-white'
              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 text-gray-900 dark:text-white'
          }`}
      >
        <span className={value && !disabled ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-slate-500'}>
          {displayText}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {typeof window !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
