import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDistricts } from '../api';
import { District } from '../types';

export default function DistrictsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['districts'],
    queryFn: getDistricts,
    staleTime: 60000, // 1 minute cache
  });

  const districts: District[] = data?.data?.data || [];

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading districts...</div>;

  return (
    <>
      <div className="page-header">
        <h2>Districts</h2>
        <p>Maharashtra districts and their stakeholder coverage</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card blue">
          <div className="stat-icon">📍</div>
          <div className="stat-value">{districts.length}</div>
          <div className="stat-label">Total Districts</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">🏢</div>
          <div className="stat-value">
            {districts.reduce((sum, d) => sum + d.stakeholdersCount, 0).toLocaleString()}
          </div>
          <div className="stat-label">Total Stakeholders</div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>District</th>
              <th>State</th>
              <th>Stakeholders</th>
              <th>Assigned Enumerators</th>
            </tr>
          </thead>
          <tbody>
            {districts.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{d.name}</td>
                <td>{d.state}</td>
                <td>{d.stakeholdersCount.toLocaleString()}</td>
                <td>
                  {d.enumeratorsCount > 0
                    ? <span className="badge badge-active">{d.enumeratorsCount} assigned</span>
                    : <span className="badge badge-pending">None</span>
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
