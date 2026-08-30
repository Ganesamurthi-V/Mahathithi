import React from 'react';

/**
 * Shared loading primitives for the admin panel.
 *
 * Before this, every page hand-rolled its own loading treatment — usually
 * `if (isLoading) return <div>Loading x...</div>`, which blanks the entire page
 * and makes the layout jump when data arrives. Several buttons had no busy state
 * at all and could be clicked repeatedly, firing duplicate mutations.
 *
 * Three rules these components encode:
 *   1. A button that triggers work shows it, and cannot be clicked twice.
 *   2. First load of a table shows a skeleton shaped like the real table, so
 *      nothing shifts when rows arrive.
 *   3. A refresh of data already on screen dims it rather than replacing it.
 */

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export type SpinnerSize = 'sm' | 'md' | 'lg';

export function Spinner({ size = 'md', className = '' }: { size?: SpinnerSize; className?: string }) {
  const sizeClass = size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : '';
  // aria-hidden because the surrounding element carries the accessible status
  // text; announcing the spinner itself would be redundant noise.
  return <span className={`spinner ${sizeClass} ${className}`.trim()} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// LoadingButton
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

interface LoadingButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  loading?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Replaces the label while loading. Omit to keep the original label. */
  loadingText?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A button that cannot be double-fired and always reports its own progress.
 *
 * `aria-busy` drives both the CSS (opacity, pointer-events) and screen-reader
 * announcement, and the button is genuinely `disabled` so a rapid second click
 * cannot slip through between renders — the reason duplicate enumerators and
 * duplicate delete calls were possible before.
 */
export function LoadingButton({
  loading = false,
  variant = 'primary',
  size = 'md',
  loadingText,
  disabled,
  className = '',
  children,
  ...rest
}: LoadingButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner size={size === 'sm' ? 'sm' : 'md'} />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page loader
// ---------------------------------------------------------------------------

/** Centred spinner for a route or modal that has nothing to show yet. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <Spinner size="lg" />
      <span className="page-loader-label">{label}</span>
    </div>
  );
}

/** Small spinner + text for use inside a row, card or toolbar. */
export function InlineLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="inline-loader" role="status" aria-live="polite">
      <Spinner size="sm" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

/**
 * Placeholder rows matching the real table's column count, so the header stays
 * put and rows fade in underneath instead of the page reflowing.
 *
 * `widths` lets a caller mimic the real content rhythm (a long name column, a
 * short PIN column), which reads as a loading table rather than grey bars.
 */
export function TableSkeleton({
  rows = 6,
  columns,
  widths,
}: {
  rows?: number;
  columns: number;
  widths?: string[];
}) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c}>
              <span
                className="skeleton skeleton-text"
                style={{ width: widths?.[c] ?? (c === 0 ? '70%' : '45%') }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Matches .stat-card's internal structure (icon, value, label). */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div className="stat-card" key={i} aria-hidden="true">
          <span className="skeleton" style={{ width: 28, height: 28, borderRadius: 8, marginBottom: 12 }} />
          <span className="skeleton" style={{ width: '55%', height: 30, marginBottom: 10 }} />
          <span className="skeleton skeleton-text" style={{ width: '75%' }} />
        </div>
      ))}
    </>
  );
}

/** Full table placeholder including the real header labels. */
export function TableSkeletonWithHeader({
  headers,
  rows = 6,
  widths,
}: {
  headers: string[];
  rows?: number;
  widths?: string[];
}) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <TableSkeleton rows={rows} columns={headers.length} widths={widths} />
      </table>
    </div>
  );
}

/**
 * Wraps a table that already has data and is quietly refetching: dims the rows
 * and floats a small badge, rather than swapping in a loader and losing the
 * user's place.
 */
export function RefetchOverlay({
  active,
  label = 'Updating…',
  children,
}: {
  active: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`table-container ${active ? 'is-refetching' : ''}`}>
      {active && (
        <div className="refetch-badge" role="status" aria-live="polite">
          <Spinner size="sm" />
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

/** Rectangular placeholder for arbitrary blocks (detail panes, media tiles). */
export function SkeletonBlock({
  width = '100%',
  height = 16,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

/**
 * Copy-to-clipboard with a confirmation flash.
 *
 * A spinner would be wrong here — the clipboard write resolves effectively
 * instantly, so a spinner would flicker and read as a glitch. The missing
 * affordance was *confirmation*: the previous buttons called
 * navigator.clipboard.writeText and said nothing, leaving the operator unsure
 * whether the DIGIPIN had been copied. A brief "Copied" state is the honest
 * signal for an action that has already completed.
 */
export function CopyButton({
  value,
  label = 'Copy',
  size = 'md',
  variant = 'secondary',
  style,
}: {
  value: string;
  label?: string;
  size?: 'sm' | 'md';
  variant?: ButtonVariant;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = (ok: boolean) => {
    setCopied(ok);
    setFailed(!ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setCopied(false); setFailed(false); }, 1600);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value ?? '');
      flash(true);
    } catch {
      // clipboard access can be blocked (insecure context, permissions policy);
      // say so rather than silently appearing to succeed.
      flash(false);
    }
  };

  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`.trim()}
      onClick={handleCopy}
      disabled={!value}
      aria-live="polite"
      style={style}
    >
      {copied ? '✓ Copied' : failed ? '✕ Failed' : label}
    </button>
  );
}
