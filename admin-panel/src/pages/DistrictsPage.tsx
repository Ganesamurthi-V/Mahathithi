import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDistricts } from '../api';
import { District } from '../types';
import { StatCardSkeleton, TableSkeletonWithHeader, InlineLoader } from '../components/Loading';

const TABLE_HEADERS = ['District', 'State', 'Stakeholders', 'Assigned Enumerators'];

export default function DistrictsPage() {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['districts'],
    queryFn: getDistricts,
    staleTime: 60000, // 1 minute cache
  });

  const districts: District[] = data?.data?.data || [];
  const isRefreshing = isFetching && !isLoading;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Districts</h2>
          <p>Maharashtra districts and their stakeholder coverage</p>
        </div>
        {isRefreshing && <InlineLoader label="Refreshing…" />}
      </div>

      <div className="stat-grid">
        {isLoading ? (
          <StatCardSkeleton count={2} />
        ) : (
          <>
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
          </>
        )}
      </div>

      {isLoading ? (
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={8}
          widths={['55%', '45%', '30%', '60%']}
        />
      ) : (
      <div className="table-container">
        <table>
          <thead>
            <tr>
              {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {districts.length === 0 && (
              <tr>
                <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No districts found.
                </td>
              </tr>
            )}
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
      )}
    </>
  );
}
