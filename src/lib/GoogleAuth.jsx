import { createContext, useContext, useState, useCallback } from 'react'
import { useGoogleLogin, googleLogout } from '@react-oauth/google'

const AuthContext = createContext(null)
const TOKEN_KEY  = 'schedule_access_token'
const EXPIRY_KEY = 'schedule_token_expiry'

function loadStoredToken() {
  const token  = localStorage.getItem(TOKEN_KEY)
  const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10)
  if (token && Date.now() < expiry) return token
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EXPIRY_KEY)
  return null
}

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState(() => loadStoredToken())

  const onSuccess = useCallback((response) => {
    const token  = response.access_token
    // subtract 60s safety margin so we never hand an about-to-expire token to the API
    const expiry = Date.now() + ((response.expires_in ?? 3600) - 60) * 1000
    setAccessToken(token)
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(EXPIRY_KEY, String(expiry))
  }, [])

  const login = useGoogleLogin({
    onSuccess,
    onError: (error) => console.error('Login failed:', error),
    scope: 'https://www.googleapis.com/auth/calendar',
    prompt: 'consent',
  })

  const logout = useCallback(() => {
    googleLogout()
    setAccessToken(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EXPIRY_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ accessToken, isSignedIn: !!accessToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
