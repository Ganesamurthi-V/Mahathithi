import React, { useState } from 'react';
import { login as apiLogin } from '../api';
import { User } from '../types';

export default function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
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
