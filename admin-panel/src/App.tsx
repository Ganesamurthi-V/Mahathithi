import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getProfile } from './api';
import { User } from './types';

// Pages
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EnumeratorsPage from './pages/EnumeratorsPage';
import StakeholdersPage from './pages/StakeholdersPage';
import DistrictsPage from './pages/DistrictsPage';
import AuditLogsPage from './pages/AuditLogsPage';

// Components
import Layout from './components/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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
            <Route index element={<DashboardPage />} />
            <Route path="stakeholders" element={<StakeholdersPage />} />
            <Route path="enumerators" element={<EnumeratorsPage />} />
            <Route path="districts" element={<DistrictsPage />} />
            <Route path="audit" element={<AuditLogsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
