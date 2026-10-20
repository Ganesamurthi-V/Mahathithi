import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCompletedSurveys, exportSurveys, getStakeholderById, getExportSyncStatus, getSurveysForReview, resolveSurveyReview, type ExportFormat } from '../api';
import {
  LoadingButton,
  TableSkeletonWithHeader,
  RefetchOverlay,
  InlineLoader,
  PageLoader,
} from '../components/Loading';
import { VerificationGalleryModal } from './StakeholdersPage';

export default function ExportPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['export-surveys-list'],
    queryFn: getCompletedSurveys,
  });

  const surveys: any[] = data?.data?.data || [];

  // Enumerators who have not been online lately. Their newest surveys may still be
  // sitting on their phones, so the operator is warned before a file goes out.
  const { data: syncData } = useQuery({ queryKey: ['export-sync-status'], queryFn: getExportSyncStatus });
  const staleEnumerators: any[] = syncData?.data?.data?.enumerators || [];
  const staleHours: number = syncData?.data?.data?.staleHours ?? 24;
  const [showStale, setShowStale] = useState(false);

  // Surveys that need a human look: far-away GPS, or field work that arrived after
  // the record was already completed by someone else.
  const { data: reviewData } = useQuery({ queryKey: ['survey-review'], queryFn: getSurveysForReview });
  const reviewItems: any[] = reviewData?.data?.data || [];
  const resolveReview = useMutation({
    mutationFn: (id: string) => resolveSurveyReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['survey-review'] });
      queryClient.invalidateQueries({ queryKey: ['export-surveys-list'] });
    },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which format is currently downloading, or null. Tracked as the format rather
  // than a boolean so only the button that was clicked shows a spinner, while both
  // are still disabled — two exports at once would mark the same rows twice.
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const exporting = exportingFormat !== null;
  // Progress/result text so the operator knows the size of the job and when it
  // finished, instead of just watching a spinner.
  const [exportNote, setExportNote] = useState('');
  // The stakeholder whose photos/survey the operator is inspecting. Export rows
  // carry only the stakeholderId, so the details modal is loaded on demand.
  const [viewStakeholderId, setViewStakeholderId] = useState<string | null>(null);

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
  const selectChanged = () => setSelected(new Set(surveys.filter((s: any) => s.changedAfterExport).map((s: any) => s.id)));

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

    if (staleEnumerators.length > 0) {
      const shown = staleEnumerators.slice(0, 5)
        .map((e: any) => '• ' + e.name + ' (' + (e.districts.join(', ') || 'no district') + ')')
        .join('\n');
      const more = staleEnumerators.length > 5 ? '\n…and ' + (staleEnumerators.length - 5) + ' more' : '';
      const ok = window.confirm(
        staleEnumerators.length + ' enumerator(s) have not been online for over ' + staleHours + ' hours, ' +
        'so their latest surveys may not be in this export:\n\n' + shown + more + '\n\nExport anyway?'
      );
      if (!ok) return;
    }

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
  const changedCount = surveys.filter((s: any) => s.changedAfterExport).length;

  const TABLE_HEADERS = ['', 'Business Name', 'Category', 'District', 'City', 'Date', 'Status', 'Details'];
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
          widths={['20px', '70%', '55%', '50%', '45%', '50%', '55%', '60%']}
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

      {staleEnumerators.length > 0 && (
        <div style={{ border: '1px solid var(--warning, #f59e0b)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>
              ⚠ {staleEnumerators.length} enumerator{staleEnumerators.length === 1 ? '' : 's'} not online for over {staleHours}h — their latest surveys may not be in an export yet.
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowStale(v => !v)}>
              {showStale ? 'Hide' : 'Show who'}
            </button>
          </div>
          {showStale && (
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              {staleEnumerators.map((e: any) => (
                <div key={e.id} style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>
                  <strong>{e.name}</strong> ({e.loginId}) · {e.districts.join(', ') || 'no district'} · {e.openRecords} open record{e.openRecords === 1 ? '' : 's'} · last online {e.lastSeenAt ? new Date(e.lastSeenAt).toLocaleString() : 'never'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {reviewItems.length > 0 && (
        <div style={{ border: '1px solid var(--warning, #f59e0b)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>
            ⚠ {reviewItems.length} survey{reviewItems.length === 1 ? '' : 's'} need{reviewItems.length === 1 ? 's' : ''} review
          </div>
          {reviewItems.map((r: any) => (
            <div key={r.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {r.businessName || r.stakeholder?.companyNameStandardized || r.stakeholder?.companyNameOriginal || '—'}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '12px' }}> · {r.enumerator?.name || '—'} · {r.district || '—'}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.reviewReason}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setViewStakeholderId(r.stakeholderId)} style={{ whiteSpace: 'nowrap' }}>
                  📸 Photos &amp; Survey
                </button>
                <LoadingButton
                  variant="primary"
                  size="sm"
                  loading={resolveReview.isPending && resolveReview.variables === r.id}
                  loadingText="Saving…"
                  onClick={() => resolveReview.mutate(r.id)}
                >
                  Mark reviewed
                </LoadingButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Selection helpers are pure local state, so they need no spinner — but
            they must not be clickable mid-export, or the selection would change
            out from under the request that is already running. */}
        <button className="btn btn-secondary btn-sm" onClick={selectNew} disabled={exporting}>Select New Only ({newCount})</button>
        <button className="btn btn-secondary btn-sm" onClick={selectChanged} disabled={exporting || changedCount === 0} title="Exported surveys that were edited afterwards, so the copy already sent is out of date">Select Changed Only ({changedCount})</button>
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
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {surveys.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No completed surveys found.</td></tr>
            )}
            {surveys.map((s: any) => (
              <tr key={s.id} style={{ opacity: s.isExported && !s.changedAfterExport ? 0.6 : 1 }}>
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
                  {s.changedAfterExport && (
                    <span className="badge badge-admin" style={{ marginLeft: '6px' }} title="Edited after it was exported; export it again to send the latest version">Changed</span>
                  )}
                  {s.needsReview && (
                    <span className="badge badge-pending" style={{ marginLeft: '6px' }} title={s.reviewReason || 'Needs review'}>⚠ Review</span>
                  )}
                </td>
                <td>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setViewStakeholderId(s.stakeholderId)}
                    disabled={!s.stakeholderId}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    📸 Photos &amp; Survey
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RefetchOverlay>

      {viewStakeholderId && (
        <SurveyDetailsModal
          stakeholderId={viewStakeholderId}
          onClose={() => setViewStakeholderId(null)}
        />
      )}
    </>
  );
}

/**
 * Loads the full stakeholder for an export row (which carries only the id), then
 * renders the same gallery modal the Stakeholders page uses so photos and survey
 * details look and behave identically in both places.
 */
function SurveyDetailsModal({ stakeholderId, onClose }: { stakeholderId: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stakeholder', stakeholderId],
    queryFn: () => getStakeholderById(stakeholderId),
  });

  const stakeholder = data?.data?.data;

  if (isLoading || (!stakeholder && !isError)) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="gallery-modal" onClick={(e) => e.stopPropagation()}>
          <PageLoader label="Loading stakeholder…" />
        </div>
      </div>
    );
  }

  if (isError || !stakeholder) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="gallery-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '32px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>Could not load this stakeholder's details.</p>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return <VerificationGalleryModal stakeholder={stakeholder} onClose={onClose} />;
}
