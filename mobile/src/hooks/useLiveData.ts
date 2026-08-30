import { useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { DATA_CHANGED_EVENT, DataResource } from '../services/realtime';

/**
 * Keep a screen's data current without the operator doing anything.
 *
 * WHY
 * Screens used to reload only inside useFocusEffect, so a screen already on
 * display never updated. If an admin corrected a stakeholder's address, or another
 * enumerator closed one in the same district, the enumerator staring at that list
 * kept seeing the old version until they navigated away and back. Worse, they
 * could open a survey on a record that had already been taken.
 *
 * This subscribes to four triggers so there is no window in which a visible
 * screen is knowingly wrong:
 *
 *   1. Navigation focus      — the original behaviour, still needed.
 *   2. Server change feed    — data:changed for the resources this screen shows.
 *   3. App foreground        — Android suspends sockets in the background, so
 *                              events during that time never arrived at all.
 *   4. Optional poll         — a safety net for a socket that is silently dead.
 *
 * @param resources Which server resources this screen renders. The callback only
 *                  fires when a change names one of them, so a screen showing
 *                  stakeholders is not re-queried because an audit log appeared.
 * @param refresh   Reload function. Must be safe to call repeatedly and should
 *                  not clear existing data first, or the screen will flicker.
 */
export function useLiveData(
  resources: DataResource[],
  refresh: () => void,
  options: { pollMs?: number; refreshOnFocus?: boolean } = {}
): void {
  const { pollMs, refreshOnFocus = true } = options;

  // Held in refs so the effects below do not re-subscribe on every render, which
  // callers would otherwise trigger by passing an inline arrow function.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;

  // --- Server change feed ---------------------------------------------------
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATA_CHANGED_EVENT,
      (payload: { resources?: string[] }) => {
        const changed = payload?.resources;
        if (!changed?.length) return;
        const relevant = changed.some((r) => resourcesRef.current.includes(r as DataResource));
        if (relevant) refreshRef.current();
      }
    );
    return () => sub.remove();
  }, []);

  // --- Returning to the foreground -----------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshRef.current();
    });
    return () => sub.remove();
  }, []);

  // --- Optional polling ----------------------------------------------------
  // Off by default. Worth enabling only for a screen whose correctness really
  // matters, as a backstop for a socket that dropped without firing an event.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => refreshRef.current(), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  // --- Navigation focus ----------------------------------------------------
  useFocusEffect(
    // Depends on nothing so the callback identity is stable; the ref keeps it
    // pointing at the latest refresh function.
    useRefStableCallback(refreshOnFocus, refreshRef)
  );
}

/**
 * A stable callback for useFocusEffect.
 *
 * useFocusEffect re-subscribes whenever its callback identity changes, so passing
 * an inline function would tear down and re-run the focus listener on every
 * render. This returns one fixed function that reads through the ref.
 */
function useRefStableCallback(enabled: boolean, refreshRef: React.MutableRefObject<() => void>) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const cb = useRef(() => {
    if (enabledRef.current) refreshRef.current();
  });
  return cb.current;
}
