import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAnalytics } from '../api';

export default function DashboardPage() {
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
  const { data: analyticsRes, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: getAnalytics,
    staleTime: 60000,
  });

  const analytics = analyticsRes?.data?.data;

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard...</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Overview of MahaAtithi stakeholder verification system</p>
        </div>
        <button className="btn btn-primary" onClick={() => window.location.href = '/export'}>
          📥 Export Surveys (SQL)
        </button>
      </div>

      <div className="stat-grid">
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
      </div>

      {/* Top Districts */}
      {analytics?.topDistricts && (
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
            <tbody>
              {analytics.topDistricts.map((d: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: '600' }}>{d.district || '—'}</td>
                  <td>{(d.count || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
