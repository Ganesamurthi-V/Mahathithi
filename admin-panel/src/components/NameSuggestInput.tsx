import React, { useEffect, useId, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { suggestStakeholders } from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { NameSuggestion, NameSuggestResponse, NameMatch } from '../types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The district chosen on the form, so "already exists here" can be answered. May be empty. */
  district: string;
  /** Open the existing record the person is about to duplicate. */
  onOpenExisting: (id: string) => void;
  /** Reports the exact same-name record in the chosen district, or null. The form blocks Create on it. */
  onExactMatch: (match: NameMatch | null) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
}

const MIN_CHARS = 3;

/** The matched part in bold, without ever treating the name as HTML. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong style={{ color: 'var(--primary)' }}>{text.slice(at, at + query.length)}</strong>
      {text.slice(at + query.length)}
    </>
  );
}

const sameDistrict = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * The business-name input of the Add Stakeholder form, with live suggestions.
 *
 * - Waits for the person to pause (250 ms) and for 3+ characters before asking the server.
 * - A request still in flight when the text changes is cancelled, and the previous list stays on
 *   screen until the next one arrives, so the list never flickers or shows answers out of order.
 * - Selecting a suggestion opens that record instead of creating a new one.
 * - When the exact name already exists in the chosen district it says so and tells the form,
 *   which blocks Create. The server enforces the same rule regardless.
 */
export default function NameSuggestInput({
  value, onChange, district, onOpenExisting, onExactMatch, disabled, placeholder, maxLength, autoFocus,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const typed = value.trim();
  const debounced = useDebouncedValue(typed, 250);
  const enabled = debounced.length >= MIN_CHARS;

  const { data, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['name-suggest', debounced, district.trim().toLowerCase()],
    queryFn: ({ signal }) => suggestStakeholders(debounced, district.trim() || undefined, { signal }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const result: NameSuggestResponse | undefined = data?.data?.data;
  // Only trust an answer for exactly what is in the box now, not for an earlier keystroke.
  const current = enabled && debounced === typed && !isPlaceholderData;
  const suggestions: NameSuggestion[] = enabled ? result?.suggestions ?? [] : [];
  const exactMatch: NameMatch | null = current ? result?.exactMatch ?? null : null;

  const exactId = exactMatch?.id ?? null;
  useEffect(() => {
    onExactMatch(exactMatch);
    // Reported by id so an identical answer does not retrigger the parent on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactId]);

  // The same name in OTHER districts is allowed; mention it so it is a decision, not a surprise.
  const elsewhere = useMemo(() => {
    if (!current) return [];
    const names = suggestions
      .filter((s) => s.nameKeyEquals && !sameDistrict(s.district, district))
      .map((s) => s.district)
      .filter((d): d is string => !!d);
    return [...new Set(names)];
  }, [current, suggestions, district]);

  useEffect(() => setActive(-1), [debounced]);

  const showList = open && suggestions.length > 0 && !disabled;

  const pick = (s: NameSuggestion) => {
    setOpen(false);
    onOpenExisting(s.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      // Choosing a suggestion must not also submit the form.
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        style={exactMatch ? { borderColor: '#e5484d' } : undefined}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          // mousedown, not click, is prevented: the input would otherwise lose focus (closing the
          // list) before the click on a row could register.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            margin: 0, padding: '4px', listStyle: 'none', maxHeight: '280px', overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)',
          }}
        >
          <li style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--text-muted)' }}>
            {isFetching ? 'Searching…' : 'Already in the system. Select one to open it instead of adding a duplicate.'}
          </li>
          {suggestions.map((s, i) => {
            const here = !!district && sameDistrict(s.district, district) && s.nameKeyEquals;
            return (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                style={{
                  padding: '8px', borderRadius: '6px', cursor: 'pointer',
                  background: i === active ? 'var(--bg-card-hover)' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Highlighted text={s.name ?? '—'} query={debounced} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {[s.district, s.city, s.pinCode].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                  {here && <span className="badge badge-inactive">Same name here</span>}
                  <span className={`badge ${s.status === 'CLOSED' ? 'badge-active' : 'badge-pending'}`}>{s.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {exactMatch && (
        <div
          role="alert"
          style={{
            marginTop: '6px', padding: '8px 10px', fontSize: '12px', color: '#e5484d',
            border: '1px solid #e5484d', borderRadius: '8px', background: 'rgba(239,68,68,0.06)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
          }}
        >
          <span>
            <strong>"{exactMatch.name}"</strong> already exists in {exactMatch.district}
            {exactMatch.city ? ` (${exactMatch.city})` : ''}. It cannot be added twice.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenExisting(exactMatch.id)}>
            Open it
          </button>
        </div>
      )}

      {!exactMatch && elsewhere.length > 0 && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
          The same name also exists in {elsewhere.join(', ')}. That is allowed.
        </div>
      )}
    </div>
  );
}
