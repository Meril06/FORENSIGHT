import { useState } from 'react';
import { login, register } from '../api.js';

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';

  function switchMode(nextMode) {
    setMode(nextMode);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const result = isLogin
        ? await login({ email, password })
        : await register({ name, email, password });

      localStorage.setItem('forensight_token', result.token);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-screen" aria-label="FORENSIGHT authentication">
      <div className="auth-shell">
        <aside className="auth-intro">
          <div>
            <div className="auth-logo-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <div className="auth-brand">FORENSIGHT</div>
            <div className="auth-kicker">DIGITAL FORENSICS TRAINING</div>

            <h1>Find the evidence.<br />Question the evidence.</h1>
            <p className="auth-intro-copy">
              A controlled investigation environment for learning how to reconstruct
              incidents, validate artifacts, and challenge assumptions.
            </p>
          </div>

          <div className="auth-process" aria-label="Investigation process">
            <span>FIND</span>
            <i />
            <span>VALIDATE</span>
            <i />
            <span>CHALLENGE</span>
          </div>
        </aside>

        <div className="auth-panel">
          <div className="auth-panel-header">
            <div>
              <span className="auth-panel-eyebrow">
                {isLogin ? 'SECURE ACCESS' : 'NEW INVESTIGATOR'}
              </span>
              <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
              <p>
                {isLogin
                  ? 'Sign in to continue your investigation.'
                  : 'Create an account to keep your investigations and scores separate.'}
              </p>
            </div>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={isLogin}
              className={isLogin ? 'active' : ''}
              onClick={() => switchMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isLogin}
              className={!isLogin ? 'active' : ''}
              onClick={() => switchMode('register')}
            >
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <label className="auth-field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="Your name"
                />
              </label>
            )}

            <label className="auth-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'}
              />
            </label>

            {error && (
              <div className="auth-error" role="alert">
                <span className="auth-error-icon" aria-hidden="true">!</span>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy} className="auth-submit">
              <span>{busy ? 'Authenticating…' : isLogin ? 'Enter investigation' : 'Create account'}</span>
              {!busy && <span className="auth-submit-arrow" aria-hidden="true">→</span>}
            </button>
          </form>

          {isLogin && (
            <div className="auth-demo-note">
              <span className="auth-demo-dot" aria-hidden="true" />
              <div>
                <strong>Development demo account</strong>
                <small>demo.trainee@forensight.local · Demo@1234</small>
              </div>
            </div>
          )}

          <p className="auth-security-note">
            Your investigation data is tied to your account and kept separate from other trainees.
          </p>
        </div>
      </div>
    </section>
  );
}
