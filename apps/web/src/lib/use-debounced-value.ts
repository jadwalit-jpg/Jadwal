import { useEffect, useState } from 'react';

/**
 * Debounce a frequently-changing value (e.g. a search input) so it only
 * propagates to downstream queries / computations after the user stops
 * changing it for `delay` ms. Default 300ms matches the AL Jadwal UX baseline.
 *
 * Usage:
 *   const [input, setInput] = useState('');
 *   const debounced = useDebouncedValue(input);
 *   useQuery({ queryKey: ['list', debounced], ... });
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
