import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompletedSurveys, exportSurveysSQL } from '../api';

export default function ExportPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['export-surveys-list'],
    queryFn: getCompletedSurveys,
  });

  const surveys: any[] = data?.data?.data || [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

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

  const handleExport = async () => {
    if (selected.size === 0) { alert('Select at least one survey to export.'); return; }
    setExporting(true);
    try {
      const res = await exportSurveysSQL([...selected]);
      const blob = new Blob([res.data], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mahaatithi_export_${new Date().toISOString().slice(0, 10)}.sql`;
      a.click();
      window.URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: ['export-surveys-list'] });
    } catch (e: any) {
      alert('Export failed: ' + (e.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  const newCount = surveys.filter((s: any) => !s.isExported).length;
  const oldCount = surveys.length - newCount;

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading surveys...</div>;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2>Export Surveys</h2>
          <p>Select surveys to export as SQL for the client's listing platform</p>
        </div>
        <button className="btn btn-primary" onClick={handleExport} disabled={selected.size === 0 || exporting} style={{ whiteSpace: 'nowrap' }}>
          {exporting ? '⏳ Exporting...' : `📥 Export Selected (${selected.size})`}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={selectNew}>Select New Only ({newCount})</button>
        <button className="btn btn-secondary btn-sm" onClick={selectAll}>Select All ({surveys.length})</button>
        <button className="btn btn-secondary btn-sm" onClick={deselectAll}>Deselect All</button>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {oldCount} previously exported · {newCount} new
        </span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input type="checkbox" checked={selected.size === surveys.length && surveys.length > 0} onChange={() => selected.size === surveys.length ? deselectAll() : selectAll()} />
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
                <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} /></td>
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
      </div>
    </>
  );
}
