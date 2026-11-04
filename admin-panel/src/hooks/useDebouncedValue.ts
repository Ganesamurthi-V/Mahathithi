import { useEffect, useState } from 'react';

/**
 * A value that follows `value` only after it has stopped changing for `delayMs`.
 *
 * For typing: the input stays instant, but a request is sent for the text the person paused on,
 * not for every keystroke on the way there. The timer is cleared on every change and on unmount,
 * so React StrictMode's double-run and a closed form never leave one firing late.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
