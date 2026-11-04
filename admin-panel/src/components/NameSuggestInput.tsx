import { useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { suggestStakeholders } from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { NameSuggestResponse, NameMatch } from '../types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The district chosen on the form. Without one there is nothing to compare against. */
  district: string;
  /** Reports the same-name record in the chosen district, or null. The form blocks Create on it. */
  onExactMatch: (match: NameMatch | null) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
}

const MIN_CHARS = 3;

/**
 * The business-name input of the Add Stakeholder form. It shows no suggestions; it only says so
 * when this name already exists in the chosen district (and tells the form, which blocks Create).
 * The server enforces the same rule regardless.
 */
export default function NameSuggestInput({
  value, onChange, district, onExactMatch, disabled, placeholder, maxLength, autoFocus,
}: Props) {
  const typed = value.trim();
  const debounced = useDebouncedValue(typed, 250);
  const dist = district.trim();
  const enabled = debounced.length >= MIN_CHARS && dist !== '';

  const { data, isPlaceholderData } = useQuery({
    queryKey: ['name-suggest', debounced, dist.toLowerCase()],
    queryFn: ({ signal }) => suggestStakeholders(debounced, dist, { signal }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const result: NameSuggestResponse | undefined = data?.data?.data;
  // Only trust an answer for exactly what is in the box now, not for an earlier keystroke.
  const current = enabled && debounced === typed && !isPlaceholderData;
  const exactMatch: NameMatch | null = current ? result?.exactMatch ?? null : null;

  const exactId = exactMatch?.id ?? null;
  useEffect(() => {
    onExactMatch(exactMatch);
    // Reported by id so an identical answer does not retrigger the parent on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactId]);

  return (
    <div>
      <input
        className="form-input"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        style={exactMatch ? { borderColor: '#e5484d' } : undefined}
      />
      {!dist && typed.length >= MIN_CHARS && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Select a district below to check whether this name already exists there.
        </div>
      )}
      {exactMatch && (
        <div role="alert" style={{ marginTop: '6px', fontSize: '12px', color: '#e5484d' }}>
          This business name already exists in {exactMatch.district}.
        </div>
      )}
      {current && result && !exactMatch && (
        <div role="status" style={{ marginTop: '6px', fontSize: '12px', color: '#16a34a' }}>
          This business name is available in {dist}.
        </div>
      )}
    </div>
  );
}
