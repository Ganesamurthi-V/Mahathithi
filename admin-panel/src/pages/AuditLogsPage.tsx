import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLogs } from '../api';

export default function AuditLogsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => getAuditLogs({ limit: 50 }),
    staleTime: 30000,
  });

  const logs = data?.data?.data?.logs || [];

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading audit logs...</div>;

  return (
    <>
      <div className="page-header">
        <h2>Audit Logs</h2>
        <p>System activity and security events</p>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>User</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
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
      </div>
    </>
  );
}
