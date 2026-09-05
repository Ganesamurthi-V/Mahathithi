import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompletedSurveys, exportSurveys, type ExportFormat } from '../api';
import {
  LoadingButton,
  TableSkeletonWithHeader,
  RefetchOverlay,
  InlineLoader,
} from '../components/Loading';

export default function ExportPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['export-surveys-list'],
    queryFn: getCompletedSurveys,
  });

  const surveys: any[] = data?.data?.data || [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which format is currently downloading, or null. Tracked as the format rather
  // than a boolean so only the button that was clicked shows a spinner, while both
  // are still disabled — two exports at once would mark the same rows twice.
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const exporting = exportingFormat !== null;
  // Progress/result text so the operator knows the size of the job and when it
  // finished, instead of just watching a spinner.
  const [exportNote, setExportNote] = useState('');

  // Auto-select only new (not exported) surveys when data loads
  useEffect(() => {
    if (surveys.length > 0) {
      const newIds = new Set(surveys.filter((s: any) => !s.isExported).map((s: any) => s.id));
      setSelected(newIds);
    }
  }, [surveys]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(surveys.map((s: any) => s.id)));
  const deselectAll = () => setSelected(new Set());
  const selectNew = () => setSelected(new Set(surveys.filter((s: any) => !s.isExported).map((s: any) => s.id)));

  /**
   * Generate and download an export in the requested format.
   *
   * This one cannot be made truly fire-and-forget: the result IS a file the
   * browser has to receive, so the request must stay open until the bytes arrive.
   * What it should not do is freeze the page — so the work runs detached from the
   * click, the rest of the UI stays interactive, and the operator is told what is
   * happening and roughly how big the job is.
   *
   * Making it genuinely background would need a server-side job that writes to
   * storage and a "your export is ready" notification. That is a larger change
   * and worth doing only if exports grow past a few thousand surveys.
   */
  const handleExport = (format: ExportFormat) => {
    if (selected.size === 0) { alert('Select at least one survey to export.'); return; }

    const count = selected.size;
    const label = format.toUpperCase();
    setExportingFormat(format);
    setExportNote(`Preparing ${count} survey${count === 1 ? '' : 's'} as ${label}…`);

    // Deliberately not awaited: the click handler returns immediately so the
    // browser never treats the tab as busy, and the promise settles on its own.
    exportSurveys([...selected], format)
      .then((res) => {
        // The blob's type must match the format, or the browser can rewrite the
        // extension on save — a CSV served as application/sql lands as .sql and
        // will not open in Excel by double-click.
        const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/sql';
        const blob = new Blob([res.data], { type: mime });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mahaatithi_export_${new Date().toISOString().slice(0, 10)}.${format}`;
        a.click();
        window.URL.revokeObjectURL(url);
        setExportNote(`Downloaded ${count} survey${count === 1 ? '' : 's'} as ${label}.`);
        // The server marked these exported and broadcast the change, so other
        // sessions update too; this refreshes ours without waiting for the event.
        queryClient.invalidateQueries({ queryKey: ['export-surveys-list'] });
        queryClient.invalidateQueries({ queryKey: ['analytics'] });
      })
      .catch(async (e: any) => {
        setExportNote('');
        // The request sets responseType: 'blob', so an error body arrives as a Blob
        // rather than parsed JSON — reading e.response.data.error.message directly
        // yields undefined and the operator sees a useless "Unknown error". The
        // server sends a specific explanation (for example that the selected
        // surveys were reopened since the list loaded), so unwrap it.
        let message = e.message || 'Unknown error';
        const body = e.response?.data;
        try {
          if (body instanceof Blob) {
            const parsed = JSON.parse(await body.text());
            message = parsed?.error?.message || message;
          } else if (body?.error?.message) {
            message = body.error.message;
          }
        } catch {
          // Not JSON — keep the transport-level message.
        }
        alert('Export failed: ' + message);
      })
      .finally(() => {
        setExportingFormat(null);
        window.setTimeout(() => setExportNote(''), 4000);
      });
  };

  const newCount = surveys.filter((s: any) => !s.isExported).length;
  const oldCount = surveys.length - newCount;

  const TABLE_HEADERS = ['', 'Business Name', 'Category', 'District', 'City', 'Date', 'Status'];
  const isRefreshing = isFetching && !isLoading;

  if (isLoading) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2>Export Surveys</h2>
            <p>Export as SQL for the client's listing platform, or as CSV for spreadsheets</p>
          </div>
        </div>
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={6}
          widths={['20px', '70%', '55%', '50%', '45%', '50%', '55%']}
        />
      </>
    );
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2>Export Surveys</h2>
          <p>Select surveys to export as SQL for the client's listing platform</p>
        </div>
        {/* Generating either format walks every selected survey plus its media, so
            on a large selection this is genuinely slow — the busy state matters.
            Both buttons disable while one runs: a second export would re-mark the
            same rows and write a duplicate audit entry. */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <LoadingButton
            variant="primary"
            loading={exportingFormat === 'sql'}
            loadingText="Generating SQL…"
            disabled={selected.size === 0 || exporting}
            onClick={() => handleExport('sql')}
            style={{ whiteSpace: 'nowrap' }}
          >
            📥 Export SQL ({selected.size})
          </LoadingButton>
          <LoadingButton
            variant="secondary"
            loading={exportingFormat === 'csv'}
            loadingText="Generating CSV…"
            disabled={selected.size === 0 || exporting}
            onClick={() => handleExport('csv')}
            style={{ whiteSpace: 'nowrap' }}
          >
            📄 Export CSV ({selected.size})
          </LoadingButton>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Selection helpers are pure local state, so they need no spinner — but
            they must not be clickable mid-export, or the selection would change
            out from under the request that is already running. */}
        <button className="btn btn-secondary btn-sm" onClick={selectNew} disabled={exporting}>Select New Only ({newCount})</button>
        <button className="btn btn-secondary btn-sm" onClick={selectAll} disabled={exporting}>Select All ({surveys.length})</button>
        <button className="btn btn-secondary btn-sm" onClick={deselectAll} disabled={exporting}>Deselect All</button>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {oldCount} previously exported · {newCount} new
        </span>
        {/* handleExport invalidates this list so freshly exported rows flip to
            "Exported"; this explains the badges changing. */}
        {isRefreshing && <InlineLoader label="Updating list…" />}
        {exportNote && (
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {exportNote}
          </span>
        )}
      </div>

      <RefetchOverlay active={isRefreshing}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selected.size === surveys.length && surveys.length > 0}
                  onChange={() => selected.size === surveys.length ? deselectAll() : selectAll()}
                  disabled={exporting}
                />
              </th>
              <th>Business Name</th>
              <th>Category</th>
              <th>District</th>
              <th>City</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {surveys.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No completed surveys found.</td></tr>
            )}
            {surveys.map((s: any) => (
              <tr key={s.id} style={{ opacity: s.isExported ? 0.6 : 1 }}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleOne(s.id)}
                    disabled={exporting}
                  />
                </td>
                <td style={{ fontWeight: '600' }}>{s.businessName || '—'}</td>
                <td>{s.businessCategory || '—'}</td>
                <td>{s.district || '—'}</td>
                <td>{s.city || '—'}</td>
                <td style={{ fontSize: '13px' }}>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                <td>
                  {s.isExported
                    ? <span className="badge badge-pending">Exported</span>
                    : <span className="badge badge-active">New</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RefetchOverlay>
    </>
  );
}
