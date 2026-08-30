import React, { useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { User } from '../types';
import { LoadingButton } from './Loading';

export default function Layout({ user, onLogout }: { user: User; onLogout: () => void | Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  const activePage = location.pathname.substring(1) || 'dashboard';

  // onLogout awaits POST /auth/logout before clearing local state, so on a slow
  // connection the button previously sat inert with no feedback and could be
  // clicked repeatedly, firing several logout requests.
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onLogout();
    } finally {
      // Only reached if logout failed and the component is still mounted; on
      // success the tree unmounts as `user` becomes null.
      setSigningOut(false);
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
            <div className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('/')}>
              <span className="icon">📊</span> Dashboard
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Management</div>
            <div className={`nav-item ${activePage === 'stakeholders' ? 'active' : ''}`} onClick={() => navigate('/stakeholders')}>
              <span className="icon">🏢</span> Stakeholders
            </div>
            <div className={`nav-item ${activePage === 'enumerators' ? 'active' : ''}`} onClick={() => navigate('/enumerators')}>
              <span className="icon">👥</span> Enumerators
            </div>
            <div className={`nav-item ${activePage === 'districts' ? 'active' : ''}`} onClick={() => navigate('/districts')}>
              <span className="icon">📍</span> Districts
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Monitoring</div>
            <div className={`nav-item ${activePage === 'audit' ? 'active' : ''}`} onClick={() => navigate('/audit')}>
              <span className="icon">📋</span> Audit Logs
            </div>
            <div className={`nav-item ${activePage === 'export' ? 'active' : ''}`} onClick={() => navigate('/export')}>
              <span className="icon">📥</span> Export SQL
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
          <LoadingButton
            variant="secondary"
            size="sm"
            loading={signingOut}
            loadingText="Signing out…"
            onClick={handleSignOut}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Sign Out
          </LoadingButton>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
