import { useState } from 'react'
import { useAuth } from '../lib/GoogleAuth.jsx'
import './ApiKeySetup.css'

export default function ApiKeySetup({ onSave }) {
  const { logout } = useAuth()
  const [key, setKey]         = useState('')
  const [visible, setVisible] = useState(false)

  const handleSave = () => {
    const trimmed = key.trim()
    if (trimmed) onSave(trimmed)
  }

  return (
    <div className="apikey-setup">
      <h2>Connect Your API Key</h2>
      <p className="apikey-setup__sub">
        Get a free API key from Google AI Studio and paste it below.
        It works entirely on the free tier. No billing or credit card required.
      </p>

      <a
        className="apikey-setup__link"
        href="https://aistudio.google.com/app/apikey"
        target="_blank"
        rel="noreferrer"
      >
        Copy API key from aistudio.google.com
      </a>

      <div className="apikey-setup__row">
        <input
          className="apikey-setup__input"
          type={visible ? 'text' : 'password'}
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="AIza…"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="apikey-setup__toggle" onClick={() => setVisible(v => !v)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      <div className="apikey-setup__save-row">
        <button
          className="apikey-setup__save"
          onClick={handleSave}
          disabled={!key.trim()}
        >
          Local Save
        </button>
        <button
          className="apikey-setup__save apikey-setup__save--server"
          disabled
          title="Coming soon"
        >
          Server Save
        </button>
      </div>

      <button className="apikey-setup__signout" onClick={logout}>
        Sign out
      </button>
    </div>
  )
}
