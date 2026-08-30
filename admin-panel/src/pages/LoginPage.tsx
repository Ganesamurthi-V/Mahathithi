import React, { useState } from 'react';
import { login as apiLogin } from '../api';
import { User } from '../types';
import { LoadingButton } from '../components/Loading';

export default function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard against a second submit slipping through before the disabled state
    // has rendered (pressing Enter twice quickly).
    if (submitting) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await apiLogin(loginId, password);
      const { enumerator } = res.data.data;

      if (!enumerator.isAdmin) {
        setError('Access denied. Admin privileges required.');
        setSubmitting(false);
        return;
      }

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
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
              <span
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', userSelect: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {showPassword ? (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </span>
            </div>
          </div>
          <LoadingButton
            id="login-submit"
            type="submit"
            variant="primary"
            loading={submitting}
            loadingText="Signing in…"
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
          >
            Sign In
          </LoadingButton>
        </form>
      </div>
    </div>
  );
}
