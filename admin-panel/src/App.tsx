import React, { useState, useEffect, useCallback } from 'react';
import { login as apiLogin, getProfile, getEnumerators, createEnumerator, updateEnumerator, deleteEnumerator, assignDistricts, getDistricts, getAnalytics, getAuditLogs } from './api';

// ============================================================================
// TYPES
// ============================================================================

interface User {
  id: string;
  loginId: string;
  name: string;
  isAdmin: boolean;
}

interface Enumerator {
  id: string;
  loginId: string;
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  districts: { id: string; name: string }[];
  surveysCount: number;
}

interface District {
  id: string;
  name: string;
  state: string;
  enumeratorsCount: number;
  stakeholdersCount: number;
}

// ============================================================================
// APP
// ============================================================================

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      getProfile()
        .then((res) => {
          if (res.data.data.isAdmin) {
            setUser(res.data.data);
          } else {
            localStorage.removeItem('admin_token');
          }
        })
        .catch(() => localStorage.removeItem('admin_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return <Dashboard user={user} onLogout={() => { localStorage.removeItem('admin_token'); setUser(null); }} />;
}

// ============================================================================
// LOGIN PAGE
// ============================================================================

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await apiLogin(loginId, password);
      const { tokens, enumerator } = res.data.data;

      if (!enumerator.isAdmin) {
        setError('Access denied. Admin privileges required.');
        setSubmitting(false);
        return;
      }

      localStorage.setItem('admin_token', tokens.accessToken);
      localStorage.setItem('admin_refresh', tokens.refreshToken);
      onLogin(enumerator);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed');
    }
    setSubmitting(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="logo-section">
          <div className="icon">🏛</div>
          <h1>MahaAthithi</h1>
          <p>Admin Control Panel</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Login ID</label>
            <input
              id="login-id"
              type="text"
              className="form-input"
              placeholder="Enter admin login ID"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [activePage, setActivePage] = useState('dashboard');
  const [analytics, setAnalytics] = useState<any>(null);
  const [enumerators, setEnumerators] = useState<Enumerator[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<Enumerator | null>(null);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  const showToast = (type: string, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    try {
      const [analyticsRes, enumRes, distRes] = await Promise.all([
        getAnalytics(),
        getEnumerators(),
        getDistricts(),
      ]);
      setAnalytics(analyticsRes.data.data);
      setEnumerators(enumRes.data.data);
      setDistricts(distRes.data.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    try {
      const res = await getAuditLogs({ limit: 50 });
      setAuditLogs(res.data.data.logs);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activePage === 'audit') loadAuditLogs();
  }, [activePage, loadAuditLogs]);

  const handleCreateEnumerator = async (data: any) => {
    try {
      await createEnumerator(data);
      showToast('success', `Enumerator "${data.name}" created successfully`);
      setShowCreateModal(false);
      loadData();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to create enumerator');
    }
  };

  const handleToggleActive = async (enumerator: Enumerator) => {
    try {
      await updateEnumerator(enumerator.id, { isActive: !enumerator.isActive });
      showToast('success', `${enumerator.name} ${enumerator.isActive ? 'deactivated' : 'activated'}`);
      loadData();
    } catch (err: any) {
      showToast('error', 'Failed to update enumerator');
    }
  };

  const handleAssignDistricts = async (enumeratorId: string, districtIds: string[]) => {
    try {
      await assignDistricts(enumeratorId, districtIds);
      showToast('success', 'Districts assigned successfully');
      setShowAssignModal(null);
      loadData();
    } catch (err: any) {
      showToast('error', 'Failed to assign districts');
    }
  };

  const handleDeleteEnumerator = async (enumerator: Enumerator) => {
    if (!window.confirm(`Are you sure you want to delete enumerator "${enumerator.name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteEnumerator(enumerator.id);
      showToast('success', `Enumerator "${enumerator.name}" deleted successfully`);
      loadData();
    } catch (err: any) {
      showToast('error', err.response?.data?.error?.message || 'Failed to delete enumerator');
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">M</div>
            <div>
              <h1>MahaAthithi</h1>
              <p>Admin Panel</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Overview</div>
            <div className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => setActivePage('dashboard')}>
              <span className="icon">📊</span> Dashboard
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Management</div>
            <div className={`nav-item ${activePage === 'enumerators' ? 'active' : ''}`} onClick={() => setActivePage('enumerators')}>
              <span className="icon">👥</span> Enumerators
            </div>
            <div className={`nav-item ${activePage === 'districts' ? 'active' : ''}`} onClick={() => setActivePage('districts')}>
              <span className="icon">📍</span> Districts
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Monitoring</div>
            <div className={`nav-item ${activePage === 'audit' ? 'active' : ''}`} onClick={() => setActivePage('audit')}>
              <span className="icon">📋</span> Audit Logs
            </div>
          </div>
        </nav>

        <div style={{ padding: '16px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: '700', fontSize: '14px', color: 'white'
            }}>
              {user.name[0]}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600' }}>{user.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{user.loginId}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {activePage === 'dashboard' && (
          <DashboardPage analytics={analytics} enumerators={enumerators} />
        )}
        {activePage === 'enumerators' && (
          <EnumeratorsPage
            enumerators={enumerators}
            districts={districts}
            onCreate={() => setShowCreateModal(true)}
            onToggleActive={handleToggleActive}
            onAssignDistricts={(e) => setShowAssignModal(e)}
            onDelete={handleDeleteEnumerator}
          />
        )}
        {activePage === 'districts' && (
          <DistrictsPage districts={districts} />
        )}
        {activePage === 'audit' && (
          <AuditLogsPage logs={auditLogs} />
        )}
      </main>

      {/* Modals */}
      {showCreateModal && (
        <CreateEnumeratorModal
          districts={districts}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateEnumerator}
        />
      )}

      {showAssignModal && (
        <AssignDistrictsModal
          enumerator={showAssignModal}
          districts={districts}
          onClose={() => setShowAssignModal(null)}
          onSubmit={handleAssignDistricts}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.type === 'success' ? '✅' : '❌'} {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DASHBOARD PAGE
// ============================================================================

function DashboardPage({ analytics, enumerators }: { analytics: any; enumerators: Enumerator[] }) {
  const statusMap = analytics?.statusBreakdown?.reduce((acc: any, s: any) => {
    acc[s.status] = s.count;
    return acc;
  }, {}) || {};

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of MahaAthithi stakeholder verification system</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card orange">
          <div className="stat-icon">🏢</div>
          <div className="stat-value">{(analytics?.totalStakeholders || 0).toLocaleString()}</div>
          <div className="stat-label">Total Stakeholders</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{(statusMap.COMPLETED || 0).toLocaleString()}</div>
          <div className="stat-label">Completed</div>
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

// ============================================================================
// ENUMERATORS PAGE
// ============================================================================

function EnumeratorsPage({
  enumerators, districts, onCreate, onToggleActive, onAssignDistricts, onDelete
}: {
  enumerators: Enumerator[];
  districts: District[];
  onCreate: () => void;
  onToggleActive: (e: Enumerator) => void;
  onAssignDistricts: (e: Enumerator) => void;
  onDelete: (e: Enumerator) => void;
}) {
  return (
    <>
      <div className="page-header">
        <h2>Enumerators</h2>
        <p>Manage field enumerators and their district assignments</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button id="create-enumerator-btn" className="btn btn-primary" onClick={onCreate}>
          + Create Enumerator
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Login ID</th>
              <th>Phone</th>
              <th>Districts</th>
              <th>Surveys</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {enumerators.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{e.name}</td>
                <td><code style={{ fontSize: '12px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>{e.loginId}</code></td>
                <td>{e.phone || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {e.districts.length > 0
                      ? e.districts.map((d) => (
                          <span key={d.id} className="badge badge-active" style={{ fontSize: '10px' }}>{d.name}</span>
                        ))
                      : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>None assigned</span>
                    }
                  </div>
                </td>
                <td>{e.surveysCount}</td>
                <td>
                  {e.isAdmin
                    ? <span className="badge badge-admin">Admin</span>
                    : e.isActive
                      ? <span className="badge badge-active">Active</span>
                      : <span className="badge badge-inactive">Inactive</span>
                  }
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onAssignDistricts(e)}>
                      📍 Districts
                    </button>
                    {!e.isAdmin && (
                      <>
                        <button
                          className={`btn btn-sm ${e.isActive ? 'btn-danger' : 'btn-success'}`}
                          onClick={() => onToggleActive(e)}
                        >
                          {e.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => onDelete(e)}
                          style={{ padding: '6px 8px' }}
                          title="Delete Enumerator"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================================
// DISTRICTS PAGE
// ============================================================================

function DistrictsPage({ districts }: { districts: District[] }) {
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

// ============================================================================
// AUDIT LOGS PAGE
// ============================================================================

function AuditLogsPage({ logs }: { logs: any[] }) {
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
            {logs.map((log) => (
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

// ============================================================================
// CREATE ENUMERATOR MODAL
// ============================================================================

function CreateEnumeratorModal({
  districts, onClose, onSubmit
}: {
  districts: District[];
  onClose: () => void;
  onSubmit: (data: any) => void;
}) {
  const [form, setForm] = useState({
    loginId: '',
    password: '',
    name: '',
    phone: '',
    email: '',
    districtIds: [] as string[],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const toggleDistrict = (id: string) => {
    setForm((prev) => ({
      ...prev,
      districtIds: prev.districtIds.includes(id)
        ? prev.districtIds.filter((d) => d !== id)
        : [...prev.districtIds, id],
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Enumerator</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Login ID *</label>
            <input id="enum-login-id" className="form-input" placeholder="e.g., enum_pune_02" required
              value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input id="enum-password" type="password" className="form-input" placeholder="Min 6 characters" required
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Full Name *</label>
            <input id="enum-name" className="form-input" placeholder="Enumerator's full name" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input id="enum-phone" className="form-input" placeholder="Mobile number"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input id="enum-email" type="email" className="form-input" placeholder="Email address"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Assign Districts</label>
            <div className="checkbox-list">
              {districts.map((d) => (
                <label key={d.id} className="checkbox-item">
                  <input type="checkbox" checked={form.districtIds.includes(d.id)}
                    onChange={() => toggleDistrict(d.id)} />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button id="enum-submit" type="submit" className="btn btn-primary">Create Enumerator</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// ASSIGN DISTRICTS MODAL
// ============================================================================

function AssignDistrictsModal({
  enumerator, districts, onClose, onSubmit
}: {
  enumerator: Enumerator;
  districts: District[];
  onClose: () => void;
  onSubmit: (enumeratorId: string, districtIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    enumerator.districts.map((d) => d.id)
  );

  const toggleDistrict = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Assign Districts to {enumerator.name}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          Select the districts this enumerator can access. They will only see stakeholders in assigned districts.
        </p>
        <div className="checkbox-list" style={{ maxHeight: '300px' }}>
          {districts.map((d) => (
            <label key={d.id} className="checkbox-item">
              <input type="checkbox" checked={selected.includes(d.id)}
                onChange={() => toggleDistrict(d.id)} />
              {d.name} ({d.stakeholdersCount.toLocaleString()})
            </label>
          ))}
        </div>
        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          {selected.length} district(s) selected
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSubmit(enumerator.id, selected)}>
            Save Assignments
          </button>
        </div>
      </div>
    </div>
  );
}
