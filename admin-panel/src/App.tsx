import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { getProfile, startSessionKeepAlive, SESSION_EXPIRED_EVENT } from './api';
import { User } from './types';
import { PageLoader } from './components/Loading';
import { connectAdminRealtime, disconnectAdminRealtime } from './realtime';

// PERF: lazy-load route pages so the initial bundle only ships the login/shell.
// Each page becomes its own chunk fetched on first navigation, cutting TTI.
// LoginPage stays eager — it's the unauthenticated entry point shown immediately.
import LoginPage from './pages/LoginPage';
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EnumeratorsPage = lazy(() => import('./pages/EnumeratorsPage'));
const StakeholdersPage = lazy(() => import('./pages/StakeholdersPage'));
const DistrictsPage = lazy(() => import('./pages/DistrictsPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));

// Components
import Layout from './components/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,

      // Refetch when the operator comes back to the tab. This was explicitly
      // false, which is a large part of why the panel showed old data: a tab left
      // open for an hour kept whatever it had until something was navigated. The
      // realtime feed handles changes while the tab is focused, and this covers
      // the gap where the socket dropped in a backgrounded tab and events were
      // missed entirely.
      refetchOnWindowFocus: true,

      // Same reasoning for regaining connectivity after a drop.
      refetchOnReconnect: true,

      // Mount always revalidates. Combined with the short staleTime below this
      // means a page cannot render stale data and leave it there.
      refetchOnMount: true,

      // Kept short rather than zero: it still collapses the burst of requests
      // fired when several components mount together, without meaningfully
      // holding on to old values, since realtime invalidation overrides it the
      // moment anything actually changes.
      staleTime: 10_000,
      gcTime: 5 * 60_000,
    },
  },
});

// Shown while a lazily-loaded route chunk is being fetched.
function RouteFallback() {
  return <PageLoader label="Loading page…" />;
}

function AppRoutes({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout user={user} onLogout={onLogout} />}>
          <Route index element={<Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>} />
          <Route path="stakeholders" element={<Suspense fallback={<RouteFallback />}><StakeholdersPage /></Suspense>} />
          <Route path="enumerators" element={<Suspense fallback={<RouteFallback />}><EnumeratorsPage /></Suspense>} />
          <Route path="districts" element={<Suspense fallback={<RouteFallback />}><DistrictsPage /></Suspense>} />
          <Route path="audit" element={<Suspense fallback={<RouteFallback />}><AuditLogsPage /></Suspense>} />
          <Route path="export" element={<Suspense fallback={<RouteFallback />}><ExportPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
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
        // Not logged in — leave user null so LoginPage renders. Deliberately no
        // redirect here; see the note in api.ts about the old reload loop.
      })
      .finally(() => setLoading(false));
  }, []);

  // Background cookie renewal, plus a listener for a genuinely dead session.
  //
  // The keep-alive is what stops the panel logging itself out after 15 minutes.
  // SESSION_EXPIRED_EVENT only fires when /auth/refresh is explicitly rejected
  // (401/403), never on a network blip, so a flaky connection cannot sign the
  // operator out. Clearing the query cache on the way out avoids showing the next
  // user data fetched under the previous session.
  useEffect(() => {
    if (!user) return;

    const stopKeepAlive = startSessionKeepAlive();

    const onExpired = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    return () => {
      stopKeepAlive();
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      disconnectAdminRealtime();
      return;
    }
    connectAdminRealtime(queryClient);
    return () => disconnectAdminRealtime();
  }, [user]);

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Even if the server call fails, drop local state — the cookies are
      // cleared server-side on success and the session is unusable either way.
    }
    setUser(null);
    queryClient.clear();
  };

  // QueryClientProvider is mounted ABOVE the auth branch on purpose.
  //
  // It used to sit inside the authenticated return, below `if (!user) return
  // <LoginPage/>`. That meant the entire React Query tree was unmounted whenever
  // user was null, so signing in constructed a brand-new provider subtree and
  // every cached query was thrown away. Hoisting it keeps one stable cache for
  // the app's lifetime; queryClient.clear() above handles discarding data
  // explicitly at logout, which is the only point it should actually be dropped.
  return (
    <QueryClientProvider client={queryClient}>
      {loading ? (
        // Initial session probe (getProfile). Full-height so the panel does not
        // flash the login form before we know whether a session exists.
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <PageLoader label="Restoring session…" />
        </div>
      ) : !user ? (
        <LoginPage onLogin={setUser} />
      ) : (
        <AppRoutes user={user} onLogout={handleLogout} />
      )}
    </QueryClientProvider>
  );
}
