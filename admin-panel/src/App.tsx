import React, { useState, useEffect, useCallback } from 'react';
import { login as apiLogin, getProfile, getEnumerators, createEnumerator, updateEnumerator, deleteEnumerator, assignDistricts, getDistricts, getAnalytics, getAuditLogs, searchStakeholders, updateStakeholder, getSurveyByStakeholder, getMediaBySurvey } from './api';

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
          <img src="/logo.png" className="icon" alt="MahaAtithi Logo" />
          <h1>MahaAtithi</h1>
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
            <img src="/logo.png" className="logo-icon" alt="MahaAtithi Logo" />
            <div>
              <h1>MahaAtithi</h1>
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
            <div className={`nav-item ${activePage === 'stakeholders' ? 'active' : ''}`} onClick={() => setActivePage('stakeholders')}>
              <span className="icon">🏢</span> Stakeholders
            </div>
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
        {activePage === 'stakeholders' && (
          <StakeholdersPage />
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

// ============================================================================
// STAKEHOLDERS PAGE
// ============================================================================

function StakeholdersPage() {
  const [stakeholders, setStakeholders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    name: '', district: '', pinCode: '', category: '', status: '',
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedStakeholder, setSelectedStakeholder] = useState<any>(null);

  const doSearch = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params: any = { page: pageNum, limit: 20 };
      if (filters.name) params.name = filters.name;
      if (filters.district) params.district = filters.district;
      if (filters.pinCode) params.pinCode = filters.pinCode;
      if (filters.category) params.category = filters.category;
      if (filters.status) params.status = filters.status;

      const res = await searchStakeholders(params);
      setStakeholders(res.data.data.stakeholders || res.data.data || []);
      setTotal(res.data.data.pagination?.total || res.data.data.total || res.data.data?.length || 0);
      setPage(pageNum);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setLoading(false);
  }, [filters]);

  // Live table filtering with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      doSearch(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, doSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(1);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'badge-pending',
      IN_PROGRESS: 'badge-active',
      IN_REVIEW: 'badge-admin',
      CLOSED: 'badge-active',
    };
    return map[status] || 'badge-pending';
  };

  return (
    <>
      <div className="page-header">
        <h2>Stakeholders</h2>
        <p>Browse and verify stakeholder submissions with photos and videos</p>
      </div>

      {/* Search Filters */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Organization Name</label>
            <input
              className="form-input"
              placeholder="Search by name..."
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
            />
          </div>
          <div style={{ flex: '1', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>District</label>
            <input
              className="form-input"
              placeholder="District"
              value={filters.district}
              onChange={(e) => setFilters({ ...filters, district: e.target.value })}
            />
          </div>
          <div style={{ flex: '1', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>PIN Code</label>
            <input
              className="form-input"
              placeholder="PIN Code"
              value={filters.pinCode}
              onChange={(e) => setFilters({ ...filters, pinCode: e.target.value })}
            />
          </div>
          <div style={{ flex: '1', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Status</label>
            <select
              className="form-input"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All</option>
              <option value="PENDING">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }} disabled={loading}>
            {loading ? '...' : '🔍 Search'}
          </button>
        </form>
      </div>

      {/* Results count */}
      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
        Showing {stakeholders.length} results {total > 0 && `of ${total.toLocaleString()} total`}
      </div>

      {/* Stakeholder Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Organization</th>
              <th>District</th>
              <th>City / Taluka</th>
              <th>PIN Code</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stakeholders.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  {loading ? 'Searching...' : 'No stakeholders found. Try adjusting your search filters.'}
                </td>
              </tr>
            )}
            {stakeholders.map((s: any) => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedStakeholder(s)}>
                <td style={{ fontWeight: '600', color: 'var(--text-primary)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.companyNameStandardized || s.companyNameOriginal || '—'}
                </td>
                <td>{s.district || '—'}</td>
                <td style={{ fontSize: '13px' }}>{s.city || s.taluka || '—'}</td>
                <td><code style={{ fontSize: '12px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>{s.pinCode || '—'}</code></td>
                <td style={{ fontSize: '12px' }}>{s.category || '—'}</td>
                <td>
                  <span className={`badge ${getStatusBadge(s.status)}`}>
                    {(s.status || 'PENDING').replace('_', ' ')}
                  </span>
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedStakeholder(s); }}>
                    📸 View Gallery
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => doSearch(page - 1)}>
          ← Previous
        </button>
        <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
          Page {page}
        </span>
        <button className="btn btn-secondary btn-sm" disabled={stakeholders.length < 20} onClick={() => doSearch(page + 1)}>
          Next →
        </button>
      </div>

      {/* Verification Gallery Modal */}
      {selectedStakeholder && (
        <VerificationGalleryModal
          stakeholder={selectedStakeholder}
          onClose={() => setSelectedStakeholder(null)}
          onStakeholderUpdated={(updated) => {
            const newList = stakeholders.map((s: any) => s.id === updated.id ? { ...s, ...updated } : s);
            setStakeholders(newList);
            setSelectedStakeholder(updated);
          }}
        />
      )}
    </>
  );
}

// ============================================================================
// VERIFICATION GALLERY MODAL
// ============================================================================

function VerificationGalleryModal({ 
  stakeholder, onClose, onStakeholderUpdated 
}: { 
  stakeholder: any; onClose: () => void; onStakeholderUpdated?: (s: any) => void 
}) {
  const [survey, setSurvey] = useState<any>(null);
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  
  // Edit State
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<any>({});

  useEffect(() => {
    setEditData({
      companyNameStandardized: stakeholder.companyNameStandardized || '',
      addressLine1: stakeholder.addressLine1 || '',
      addressLine2: stakeholder.addressLine2 || '',
      city: stakeholder.city || '',
      taluka: stakeholder.taluka || '',
      village: stakeholder.village || '',
      district: stakeholder.district || '',
      state: stakeholder.state || '',
      pinCode: stakeholder.pinCode || '',
      category: stakeholder.category || '',
    });
  }, [stakeholder]);

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const res = await updateStakeholder(stakeholder.id, editData);
      setEditMode(false);
      if (onStakeholderUpdated) {
        onStakeholderUpdated(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to update stakeholder:', err);
      alert(err.response?.data?.error?.message || 'Failed to update stakeholder');
    }
    setSaving(false);
  };

  useEffect(() => {
    loadVerificationData();
  }, [stakeholder.id]);

  const loadVerificationData = async () => {
    setLoading(true);
    try {
      // Load survey
      const svRes = await getSurveyByStakeholder(stakeholder.id).catch(() => ({ data: { data: null } }));
      const surveyData = svRes.data.data;
      setSurvey(surveyData);

      // Load media if survey exists
      if (surveyData?.id) {
        const mediaRes = await getMediaBySurvey(surveyData.id).catch(() => ({ data: { data: [] } }));
        setMedia(mediaRes.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load verification data:', err);
    }
    setLoading(false);
  };

  const photos = media.filter((m: any) => m.type === 'PHOTO');
  const videos = media.filter((m: any) => m.type === 'VIDEO');

  const categoryLabels: Record<string, string> = {
    BUILDING_FRONT: '🏢 Building Front',
    SIGNBOARD: '🪧 Signboard',
    INTERIOR: '🏠 Interior',
    STAKEHOLDER: '👤 Stakeholder',
    ADDITIONAL: '📸 Additional',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gallery-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="gallery-header">
          <div>
            <h3 style={{ margin: 0 }}>{stakeholder.companyNameStandardized || stakeholder.companyNameOriginal}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
              {stakeholder.district} • {stakeholder.pinCode} • <span className={`badge ${stakeholder.status === 'CLOSED' ? 'badge-active' : 'badge-pending'}`}>{(stakeholder.status || 'OPEN').replace('_', ' ')}</span>
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ fontSize: '18px', padding: '8px 12px' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
            Loading verification data...
          </div>
        ) : (
          <div className="gallery-body">
            {/* Stakeholder Info */}
            <div className="gallery-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 className="gallery-section-title" style={{ margin: 0 }}>📋 Stakeholder Details</h4>
                {editMode ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(false)} disabled={saving}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(true)}>✏️ Edit</button>
                )}
              </div>

              {editMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Organization Name</label>
                    <input className="form-input" value={editData.companyNameStandardized} onChange={(e) => setEditData({...editData, companyNameStandardized: e.target.value})} />
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Address Line 1</label>
                      <input className="form-input" value={editData.addressLine1} onChange={(e) => setEditData({...editData, addressLine1: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Address Line 2</label>
                      <input className="form-input" value={editData.addressLine2} onChange={(e) => setEditData({...editData, addressLine2: e.target.value})} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>City</label>
                      <input className="form-input" value={editData.city} onChange={(e) => setEditData({...editData, city: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Taluka</label>
                      <input className="form-input" value={editData.taluka} onChange={(e) => setEditData({...editData, taluka: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Village</label>
                      <input className="form-input" value={editData.village} onChange={(e) => setEditData({...editData, village: e.target.value})} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>District</label>
                      <input className="form-input" value={editData.district} onChange={(e) => setEditData({...editData, district: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>State</label>
                      <input className="form-input" value={editData.state} onChange={(e) => setEditData({...editData, state: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>PIN Code</label>
                      <input className="form-input" value={editData.pinCode} onChange={(e) => setEditData({...editData, pinCode: e.target.value})} />
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Category</label>
                    <input className="form-input" value={editData.category} onChange={(e) => setEditData({...editData, category: e.target.value})} />
                  </div>
                  {/* Locked Fields */}
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-input)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' }}>Locked Identifiers</div>
                    <div className="gallery-info-grid">
                      <div className="gallery-info-item"><span className="gallery-info-label">GST</span><span className="gallery-info-value">{stakeholder.gstNumber || '—'}</span></div>
                      <div className="gallery-info-item"><span className="gallery-info-label">NIC Code</span><span className="gallery-info-value">{stakeholder.nicCode || '—'}</span></div>
                      <div className="gallery-info-item"><span className="gallery-info-label">Original Name</span><span className="gallery-info-value">{stakeholder.companyNameOriginal || '—'}</span></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="gallery-info-grid">
                  {[
                    { label: 'Address', value: stakeholder.addressLine1 || stakeholder.fullAddressRaw },
                    { label: 'City', value: stakeholder.city },
                    { label: 'Taluka', value: stakeholder.taluka },
                    { label: 'Village', value: stakeholder.village },
                    { label: 'Category', value: stakeholder.category },
                    { label: 'GST', value: stakeholder.gstNumber },
                    { label: 'NIC Code', value: stakeholder.nicCode },
                    { label: 'NIC Description', value: stakeholder.nicDescription },
                  ].filter(r => r.value).map((row, i) => (
                    <div key={i} className="gallery-info-item">
                      <span className="gallery-info-label">{row.label}</span>
                      <span className="gallery-info-value">{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Survey Data */}
            {survey && (
              <div className="gallery-section">
                <h4 className="gallery-section-title">📝 Survey Data</h4>
                <div className="gallery-info-grid">
                  {[
                    { label: 'Contact Person', value: survey.contactPerson },
                    { label: 'Designation', value: survey.designation },
                    { label: 'Mobile', value: survey.mobileNumber },
                    { label: 'Email', value: survey.email },
                    { label: 'Website', value: survey.website },
                    { label: 'Org Type', value: survey.organizationType },
                    { label: 'GPS', value: survey.latitude ? `${survey.latitude.toFixed(5)}, ${survey.longitude.toFixed(5)}` : null },
                    { label: 'Remarks', value: survey.remarks },
                  ].filter(r => r.value).map((row, i) => (
                    <div key={i} className="gallery-info-item">
                      <span className="gallery-info-label">{row.label}</span>
                      <span className="gallery-info-value">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Surveyed by: {survey.enumerator?.name || 'Unknown'} • {survey.createdAt ? new Date(survey.createdAt).toLocaleDateString() : ''}
                </div>
              </div>
            )}

            {/* Photo Gallery */}
            <div className="gallery-section">
              <h4 className="gallery-section-title">📷 Verification Photos ({photos.length})</h4>
              {photos.length > 0 ? (
                <div className="photo-grid">
                  {photos.map((photo: any) => (
                    <div key={photo.id} className="photo-card" onClick={() => setLightbox(photo.fileUrl)}>
                      <img src={photo.fileUrl} alt={photo.photoCategory || 'Photo'} />
                      <div className="photo-card-overlay">
                        <span className="photo-card-category">{categoryLabels[photo.photoCategory] || photo.photoCategory}</span>
                        {photo.latitude && (
                          <span className="photo-card-gps">📍 {photo.latitude.toFixed(4)}, {photo.longitude.toFixed(4)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="gallery-empty">No photos uploaded yet</div>
              )}
            </div>

            {/* Video Section */}
            <div className="gallery-section">
              <h4 className="gallery-section-title">🎥 Verification Video ({videos.length})</h4>
              {videos.length > 0 ? (
                <div className="video-grid">
                  {videos.map((video: any) => (
                    <div key={video.id} className="video-card">
                      <video controls preload="metadata" style={{ width: '100%', borderRadius: '8px' }}>
                        <source src={video.fileUrl} type={video.mimeType || 'video/mp4'} />
                        Your browser does not support video playback.
                      </video>
                      <div className="video-meta">
                        <span>📐 {video.fileSize ? `${(video.fileSize / (1024 * 1024)).toFixed(1)} MB` : '—'}</span>
                        <span>⏱️ {video.duration ? `${video.duration}s` : '—'}</span>
                        {video.latitude && <span>📍 {video.latitude.toFixed(4)}, {video.longitude.toFixed(4)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="gallery-empty">No video uploaded yet</div>
              )}
            </div>

            {/* No Media at all */}
            {!survey && media.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                <p>No survey or media data has been submitted for this stakeholder yet.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Full size" />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
