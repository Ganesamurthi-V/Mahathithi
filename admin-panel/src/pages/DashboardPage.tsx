import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAnalytics, getEnumerators } from '../api';
import { Enumerator } from '../types';

export default function DashboardPage() {
  const { data: analyticsRes, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: getAnalytics,
    staleTime: 60000,
  });

  const { data: enumeratorsRes, isLoading: enumLoading } = useQuery({
    queryKey: ['enumerators'],
    queryFn: getEnumerators,
    staleTime: 60000,
  });

  const analytics = analyticsRes?.data?.data;
  const enumerators: Enumerator[] = enumeratorsRes?.data?.data || [];

  const statusMap = analytics?.statusBreakdown?.reduce((acc: any, s: any) => {
    acc[s.status] = s.count;
    return acc;
  }, {}) || {};

  if (analyticsLoading || enumLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading dashboard...</div>;
  }

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of MahaAtithi stakeholder verification system</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card orange">
          <div className="stat-icon">🏢</div>
          <div className="stat-value">{(analytics?.totalStakeholders || 0).toLocaleString()}</div>
          <div className="stat-label">Total Stakeholders</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{(statusMap.CLOSED || 0).toLocaleString()}</div>
          <div className="stat-label">Closed</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon">⏳</div>
          <div className="stat-value">{(statusMap.PENDING || 0).toLocaleString()}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-icon">🔍</div>
          <div className="stat-value">{(statusMap.IN_REVIEW || 0).toLocaleString()}</div>
          <div className="stat-label">In Review</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{enumerators.length}</div>
          <div className="stat-label">Enumerators</div>
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
              {analytics.topDistricts.slice(0, 10).map((d: any, i: number) => (
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
