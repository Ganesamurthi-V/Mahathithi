import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCompletedSurveys, exportSurveysSQL } from '../api';

const EXPORTED_KEY = 'mahaatithi_exported_survey_ids';

function getExportedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPORTED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveExportedIds(ids: Set<string>) {
  localStorage.setItem(EXPORTED_KEY, JSON.stringify([...ids]));
}

export default function ExportPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['export-surveys-list'],
    queryFn: getCompletedSurveys,
  });

  const surveys: any[] = data?.data?.data || [];
  const previouslyExported = useMemo(() => getExportedIds(), []);

  // Auto-select only NEW surveys (not previously exported)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (surveys.length > 0) {
      const newIds = new Set(
        surveys.filter(s => !previouslyExported.has(s.id)).map(s => s.id)
      );
      setSelected(newIds);
    }
  }, [surveys, previouslyExported]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(surveys.map(s => s.id)));
  const deselectAll = () => setSelected(new Set());
  const selectNew = () => setSelected(new Set(surveys.filter(s => !previouslyExported.has(s.id)).map(s => s.id)));

  const handleExport = async () => {
    if (selected.size === 0) { alert('Select at least one survey to export.'); return; }
    try {
      const res = await exportSurveysSQL([...selected]);
      const blob = new Blob([res.data], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mahaatithi_export_${new Date().toISOString().slice(0, 10)}.sql`;
      a.click();
      window.URL.revokeObjectURL(url);

      // Mark these as exported
      const updated = new Set([...previouslyExported, ...selected]);
      saveExportedIds(updated);
    } catch (e: any) {
      alert('Export failed: ' + (e.message || 'Unknown error'));
    }
  };

  const newCount = surveys.filter(s => !previouslyExported.has(s.id)).length;
  const oldCount = surveys.length - newCount;

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading surveys...</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Export Surveys</h2>
          <p>Select surveys to export as SQL for the client's listing platform</p>
        </div>
        <button className="btn btn-primary" onClick={handleExport} disabled={selected.size === 0}>
          📥 Export Selected ({selected.size})
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
                <input type="checkbox" checked={selected.size === surveys.length} onChange={() => selected.size === surveys.length ? deselectAll() : selectAll()} />
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
            {surveys.map((s: any) => {
              const isNew = !previouslyExported.has(s.id);
              return (
                <tr key={s.id} style={{ opacity: isNew ? 1 : 0.6 }}>
                  <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} /></td>
                  <td style={{ fontWeight: '600' }}>{s.businessName || '—'}</td>
                  <td>{s.businessCategory || '—'}</td>
                  <td>{s.district || '—'}</td>
                  <td>{s.city || '—'}</td>
                  <td style={{ fontSize: '13px' }}>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    {isNew
                      ? <span className="badge badge-active">New</span>
                      : <span className="badge badge-pending">Exported</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
