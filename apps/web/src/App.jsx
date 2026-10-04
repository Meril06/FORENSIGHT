import { useEffect, useState } from 'react';
import CaseLibrary from './components/CaseLibrary.jsx';
import CaseOverview from './components/CaseOverview.jsx';
import Workspace from './components/Workspace.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import { getMe } from './api.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [screen, setScreen] = useState('library');
  const [caseId, setCaseId] = useState(null);
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('forensight_token')) {
      setCheckingAuth(false);
      return;
    }
    getMe()
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => {}) // if the server is unreachable, keep the login; a 401 is handled in api.js
      .finally(() => setCheckingAuth(false));
  }, []);

  function goToLibrary() {
    setSession(null);
    setScreen('library');
  }

  function logout() {
    localStorage.removeItem('forensight_token');
    setUser(null);
    setSession(null);
    setCaseId(null);
    setScreen('library');
  }

  if (checkingAuth) return <div className="app"><main><p>Checking your account...</p></main></div>;
  if (!user) return <div className="app"><AuthScreen onAuthenticated={setUser} /></div>;

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={goToLibrary}>FORENSIGHT</button>
        <span>Adversarial digital-forensics training</span>
        <div className="user-menu">
          <span>{user.name}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <main>
        {screen === 'library' && (
          <CaseLibrary
            onSelect={(id) => {
              setCaseId(id);
              setScreen('overview');
            }}
          />
        )}

        {screen === 'overview' && (
          <CaseOverview
            caseId={caseId}
            onBack={goToLibrary}
            onStarted={(newSession) => {
              setSession(newSession);
              setScreen('workspace');
            }}
          />
        )}

        {screen === 'workspace' && <Workspace caseId={caseId} session={session} />}
      </main>
    </div>
  );
}