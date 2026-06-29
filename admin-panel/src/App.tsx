import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getProfile } from './api';
import { User } from './types';

// PERF: lazy-load route pages so the initial bundle only ships the login/shell.
// Each page becomes its own chunk fetched on first navigation, cutting TTI.
// LoginPage stays eager — it's the unauthenticated entry point shown immediately.
import LoginPage from './pages/LoginPage';
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EnumeratorsPage = lazy(() => import('./pages/EnumeratorsPage'));
const StakeholdersPage = lazy(() => import('./pages/StakeholdersPage'));
const DistrictsPage = lazy(() => import('./pages/DistrictsPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));

// Components
import Layout from './components/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // PERF: cache responses for 30s and keep them 5m so navigating between
      // pages doesn't refetch immediately on every mount.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '60vh' }}>
      <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProfile()
      .then((res) => {
        if (res.data.data.isAdmin) {
          setUser(res.data.data);
        }
      })
      .catch(() => {
        // Not logged in
      })
      .finally(() => setLoading(false));
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

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout user={user} onLogout={async () => {
            try {
              await import('./api').then(m => m.default.post('/auth/logout'));
            } catch (e) {}
            setUser(null);
          }} />}>
            <Route index element={<Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>} />
            <Route path="stakeholders" element={<Suspense fallback={<RouteFallback />}><StakeholdersPage /></Suspense>} />
            <Route path="enumerators" element={<Suspense fallback={<RouteFallback />}><EnumeratorsPage /></Suspense>} />
            <Route path="districts" element={<Suspense fallback={<RouteFallback />}><DistrictsPage /></Suspense>} />
            <Route path="audit" element={<Suspense fallback={<RouteFallback />}><AuditLogsPage /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
