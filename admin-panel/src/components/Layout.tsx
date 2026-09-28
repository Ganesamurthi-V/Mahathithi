import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { User } from '../types';
import { LoadingButton } from './Loading';

export default function Layout({ user, onLogout }: { user: User; onLogout: () => void | Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  // Mobile off-canvas sidebar. Desktop ignores this (CSS shows the sidebar
  // regardless); on small screens the `open` class slides it in over a backdrop.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activePage = location.pathname.substring(1) || 'dashboard';

  // Close the drawer whenever the route changes, so tapping a nav item on mobile
  // navigates AND dismisses the sidebar in one action.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Navigate helper that also closes the drawer (covers taps on the already-active
  // item, where the pathname effect above would not fire).
  const go = (path: string) => {
    navigate(path);
    setSidebarOpen(false);
  };

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
      {/* Mobile top bar — only visible on small screens (CSS). Holds the
          hamburger toggle and the brand, so the fixed sidebar can be hidden. */}
      <header className="mobile-topbar">
        <button
          className="hamburger-btn"
          aria-label="Open menu"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <div className="mobile-topbar-brand">
          <img src="/logo.png" className="logo-icon" alt="MahaAtithi Logo" />
          <span>MahaAtithi</span>
        </div>
      </header>

      {/* Backdrop behind the open drawer (mobile only). Tapping it closes. */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img src="/logo.png" className="logo-icon" alt="MahaAtithi Logo" />
            <div>
              <h1>MahaAtithi</h1>
              <p>Admin Panel</p>
            </div>
          </div>
          {/* Close button — mobile only (CSS hides it on desktop). */}
          <button className="sidebar-close" aria-label="Close menu" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Overview</div>
            <div className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => go('/')}>
              <span className="icon">📊</span> Dashboard
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Management</div>
            <div className={`nav-item ${activePage === 'stakeholders' ? 'active' : ''}`} onClick={() => go('/stakeholders')}>
              <span className="icon">🏢</span> Stakeholders
            </div>
            <div className={`nav-item ${activePage === 'enumerators' ? 'active' : ''}`} onClick={() => go('/enumerators')}>
              <span className="icon">👥</span> Enumerators
            </div>
            <div className={`nav-item ${activePage === 'districts' ? 'active' : ''}`} onClick={() => go('/districts')}>
              <span className="icon">📍</span> Districts
            </div>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Monitoring</div>
            <div className={`nav-item ${activePage === 'audit' ? 'active' : ''}`} onClick={() => go('/audit')}>
              <span className="icon">📋</span> Audit Logs
            </div>
            <div className={`nav-item ${activePage === 'export' ? 'active' : ''}`} onClick={() => go('/export')}>
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
