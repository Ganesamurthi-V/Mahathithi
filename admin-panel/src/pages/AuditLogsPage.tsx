import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLogs } from '../api';
import { LoadingButton, TableSkeletonWithHeader, RefetchOverlay, InlineLoader } from '../components/Loading';

const TABLE_HEADERS = ['Timestamp', 'Action', 'User', 'Entity', 'Details'];

export default function AuditLogsPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => getAuditLogs({ limit: 50 }),
    staleTime: 30000,
  });

  const logs = data?.data?.data?.logs || [];
  const isRefreshing = isFetching && !isLoading;

  // First load: a table-shaped placeholder keeps the page header and column
  // widths stable, rather than swapping the whole page for a line of text.
  if (isLoading) {
    return (
      <>
        <div className="page-header">
          <h2>Audit Logs</h2>
          <p>System activity and security events</p>
        </div>
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={10}
          widths={['70%', '55%', '50%', '65%', '85%']}
        />
      </>
    );
  }

  // The query previously had no error branch, so a failed request rendered an
  // empty table that was indistinguishable from "no activity yet".
  if (isError) {
    return (
      <>
        <div className="page-header">
          <h2>Audit Logs</h2>
          <p>System activity and security events</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ marginBottom: '12px', color: 'var(--error)', fontWeight: 600 }}>
            Could not load audit logs
          </div>
          <div style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
            {(error as any)?.response?.data?.error?.message || (error as any)?.message || 'Unknown error'}
          </div>
          {/* refetch() is a network call — without a busy state this button looks
              dead on a slow or still-failing connection and invites repeat clicks. */}
          <LoadingButton
            variant="primary"
            loading={isFetching}
            loadingText="Retrying…"
            onClick={() => refetch()}
          >
            Try Again
          </LoadingButton>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Audit Logs</h2>
          <p>System activity and security events</p>
        </div>
        {isRefreshing && <InlineLoader label="Refreshing…" />}
      </div>

      <RefetchOverlay active={isRefreshing}>
        <table>
          <thead>
            <tr>
              {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No audit activity recorded yet.
                </td>
              </tr>
            )}
            {logs.map((log: any) => (
              <tr key={log.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td>
                  <span className="badge badge-active" style={{ fontSize: '10px' }}>
                    {log.action}
                  </span>
                </td>
                <td>{log.enumerator?.name || '—'}</td>
                <td style={{ fontSize: '12px' }}>{log.entityType} / {log.entityId?.substring(0, 8)}...</td>
                <td style={{ fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {log.details ? JSON.stringify(log.details).substring(0, 60) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RefetchOverlay>
    </>
  );
}
