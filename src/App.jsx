import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, useAuth } from './lib/GoogleAuth.jsx'
import MessageView from './components/MessageView.jsx'
import CalendarView from './components/CalendarView.jsx'
import ApiKeySetup from './components/ApiKeySetup.jsx'
import logoBlack from './assets/ScheduleAid.png'
import logoWhite from './assets/ScheduleAidWhite.png'
import './App.css'

const STORAGE_KEY = 'api_key'

function SignInScreen() {
  const { login } = useAuth()

  return (
    <div className="signin-screen">
      <picture>
        <source srcSet={logoWhite} media="(prefers-color-scheme: dark)" />
        <img src={logoBlack} alt="ScheduleAI'd" className="app-logo app-logo--lg" />
      </picture>
      <h1>ScheduleAI'd</h1>
      <p>Sign in with Google to manage your calendar with an AI aide.</p>
      <button className="signin-btn" onClick={login}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </button>
    </div>
  )
}

function SettingsMenu({ onSaveKey }) {
  const [open,    setOpen]    = useState(false)
  const [key,     setKey]     = useState('')
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)

  // close when the user clicks outside the menu
  useEffect(() => {
    if (!open) return
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSave = () => {
    const trimmed = key.trim()
    if (!trimmed) return
    onSaveKey(trimmed)
    setKey('')
    setOpen(false)
  }

  return (
    <div className="settings-menu" ref={ref}>
      <button
        className="settings-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Settings"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a6.96 6.96 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
        </svg>
      </button>

      {open && (
        <div className="settings-menu__dropdown">
          <p className="settings-menu__heading">API Key</p>
          <div className="settings-menu__row">
            <input
              className="settings-menu__input"
              type={visible ? 'text' : 'password'}
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Paste new key…"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="settings-menu__toggle" onClick={() => setVisible(v => !v)}>
              {visible ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            className="settings-menu__save"
            onClick={handleSave}
            disabled={!key.trim()}
          >
            Update
          </button>
          <a
            className="settings-menu__studio-link"
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Get or copy API key at Google AI Studio
          </a>
          <p className="settings-menu__footer">
            © {new Date().getFullYear()} <a href="https://HarshSharma.dev" target="_blank" rel="noreferrer">HarshSharma.dev</a>. All rights reserved.
          </p>
        </div>
      )}
    </div>
  )
}

function MainApp({ apiKey, onSaveKey, onClearApiKey }) {
  const { logout } = useAuth()
  const [refreshCount,     setRefreshCount]     = useState(0)
  const [mobileView,       setMobileView]       = useState('chat') // 'chat' | 'calendar'
  const [highlightEventId, setHighlightEventId] = useState(null)

  const handleSignOut = () => {
    logout()
    onClearApiKey()
  }

  const handleEventsChanged = useCallback(() => {
    setRefreshCount(c => c + 1)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <picture>
            <source srcSet={logoWhite} media="(prefers-color-scheme: dark)" />
            <img src={logoBlack} alt="" className="app-logo" aria-hidden="true" />
          </picture>
          <span className="app-header__title">ScheduleAI'd</span>
        </div>
        <div className="app-header__actions">
          <button
            className="toggle-btn"
            onClick={() => setMobileView(v => v === 'chat' ? 'calendar' : 'chat')}
            aria-label="Toggle view"
          >
            {mobileView === 'chat' ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 4h-1V2h-2v2H8V2H6v2H5C3.89 4 3 4.9 3 6v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
            )}
          </button>
          <SettingsMenu onSaveKey={onSaveKey} />
          <button className="signout-btn" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>
      <div className="app-body">
        <div className={`app-body__calendar${mobileView === 'calendar' ? ' app-body__calendar--active' : ''}`}>
          <CalendarView refreshCount={refreshCount} highlightEventId={highlightEventId} />
        </div>
        <div className={`app-body__chat${mobileView === 'chat' ? ' app-body__chat--active' : ''}`}>
          <MessageView apiKey={apiKey} onEventsChanged={handleEventsChanged} onPendingEvent={setHighlightEventId} />
        </div>
      </div>
    </div>
  )
}

function AppContent() {
  const { isSignedIn } = useAuth()
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY))

  const handleSaveKey = (key) => {
    localStorage.setItem(STORAGE_KEY, key)
    setApiKey(key)
  }

  const handleClearKey = () => {
    localStorage.removeItem(STORAGE_KEY)
    setApiKey(null)
  }

  if (!isSignedIn)  return <SignInScreen />
  if (!apiKey)      return <ApiKeySetup onSave={handleSaveKey} />
  return <MainApp apiKey={apiKey} onSaveKey={handleSaveKey} onClearApiKey={handleClearKey} />
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}
