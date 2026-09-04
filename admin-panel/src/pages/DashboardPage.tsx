import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAnalytics } from '../api';
import { StatCardSkeleton, TableSkeleton, InlineLoader } from '../components/Loading';

export default function DashboardPage() {
  // PERF: this used `window.location.href = '/export'`, a hard browser
  // navigation that discarded the SPA, re-downloaded the bundle and re-ran the
  // session probe. Router navigation just swaps the route.
  const navigate = useNavigate();
  // PERF: one request, not two.
  //
  // This page also issued getEnumerators() — a findMany with nested district joins
  // and a per-enumerator survey count, the slowest query in the panel at ~190ms —
  // solely to display `enumerators.length`. /analytics now returns
  // totalEnumerators, so that entire request is gone.
  //
  // Also removed: a `statusMap` local computed from `analytics.statusBreakdown`.
  // Nothing rendered it, and statusBreakdown was never actually returned by the
  // live route, so it reduced over undefined on every render.
  const { data: analyticsRes, isLoading, isFetching } = useQuery({
    queryKey: ['analytics'],
    queryFn: getAnalytics,
    staleTime: 60000,
  });

  const analytics = analyticsRes?.data?.data;

  // First load renders skeletons in the real layout instead of blanking the page,
  // so the header and card grid stay put and only the values fade in. `isFetching`
  // (as opposed to `isLoading`) also covers the realtime-triggered refresh, which
  // is surfaced as a quiet badge rather than a full reload.
  const isRefreshing = isFetching && !isLoading;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Overview of MahaAtithi stakeholder verification system</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Realtime survey completions invalidate this query. Showing the
              refresh keeps the numbers trustworthy — otherwise they change
              under the operator with no explanation. */}
          {isRefreshing && <InlineLoader label="Refreshing…" />}
          <button className="btn btn-primary" onClick={() => navigate('/export')}>
            📥 Export Surveys (SQL)
          </button>
        </div>
      </div>

      <div className="stat-grid">
        {isLoading ? (
          <StatCardSkeleton count={4} />
        ) : (
          <>
            <div className="stat-card orange">
              <div className="stat-icon">🏢</div>
              <div className="stat-value">{(analytics?.totalStakeholders || 0).toLocaleString()}</div>
              <div className="stat-label">Total Stakeholders</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon">✅</div>
              <div className="stat-value">{(analytics?.completedSurveys || 0).toLocaleString()}</div>
              <div className="stat-label">Completed Surveys</div>
            </div>
            <div className="stat-card red">
              <div className="stat-icon">👥</div>
              <div className="stat-value">{(analytics?.totalEnumerators || 0).toLocaleString()}</div>
              <div className="stat-label">Enumerators</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-icon">📤</div>
              <div className="stat-value">{(analytics?.exportedSurveys || 0).toLocaleString()}</div>
              <div className="stat-label">Exported Surveys</div>
            </div>
          </>
        )}
      </div>

      {/* Top Districts — survey progress.
          `count` is the district's total stakeholders and `completedSurveys` is
          how many of them have a completed survey; both come from /admin/analytics
          keyed on the same district field, so the two are directly comparable. */}
      <div className="table-container" style={{ marginBottom: '24px' }}>
        <div className="table-header">
          <h3>Survey Progress by District</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>District</th>
              <th style={{ textAlign: 'right' }}>Total Stakeholders</th>
              <th style={{ textAlign: 'right' }}>Completed Surveys</th>
              <th style={{ width: '180px' }}>Coverage</th>
            </tr>
          </thead>
          {isLoading ? (
            <TableSkeleton rows={10} columns={4} widths={['60%', '40%', '40%', '70%']} />
          ) : (
            <tbody>
              {(!analytics?.topDistricts || analytics.topDistricts.length === 0) && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    No district data available.
                  </td>
                </tr>
              )}
              {(analytics?.topDistricts || []).map((d: any, i: number) => {
                const total = d.count || 0;
                const done = d.completedSurveys || 0;
                // Recomputed client-side rather than trusting the server value, so
                // an older backend that does not yet send `coverage` still renders.
                const pct = total > 0 ? (done / total) * 100 : 0;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: '600' }}>{d.district || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{total.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: done > 0 ? 600 : 400, color: done > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {done.toLocaleString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}
                          role="progressbar"
                          aria-valuenow={Number(pct.toFixed(2))}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${d.district || 'District'} survey coverage`}
                        >
                          {/* Sub-1% coverage still shows a sliver so "started" is
                              visually distinct from "nothing yet". */}
                          <div style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%`, height: '100%', background: 'var(--primary)' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '48px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {/* Small non-zero values would read as "0.00%" at 2dp. */}
                          {done === 0 ? '0%' : pct < 0.01 ? '<0.01%' : `${pct.toFixed(2)}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}
