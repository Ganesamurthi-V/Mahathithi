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

      {/* Top Districts */}
      <div className="table-container" style={{ marginBottom: '24px' }}>
        <div className="table-header">
          <h3>Top Districts by Stakeholder Count</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>District</th>
              <th>Stakeholders</th>
            </tr>
          </thead>
          {isLoading ? (
            <TableSkeleton rows={10} columns={2} widths={['60%', '30%']} />
          ) : (
            <tbody>
              {(!analytics?.topDistricts || analytics.topDistricts.length === 0) && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    No district data available.
                  </td>
                </tr>
              )}
              {(analytics?.topDistricts || []).map((d: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: '600' }}>{d.district || '—'}</td>
                  <td>{(d.count || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}
