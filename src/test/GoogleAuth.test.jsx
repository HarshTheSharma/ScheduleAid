import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from '../lib/GoogleAuth.jsx'

let capturedOnSuccess

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: ({ onSuccess }) => {
    capturedOnSuccess = onSuccess
    return vi.fn()
  },
  googleLogout: vi.fn(),
  GoogleOAuthProvider: ({ children }) => children,
}))

function TestConsumer() {
  const { isSignedIn, accessToken, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="signed-in">{String(isSignedIn)}</span>
      <span data-testid="token">{accessToken ?? 'null'}</span>
      <button onClick={login}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

function renderWithAuth() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    capturedOnSuccess = null
    localStorage.clear()
  })

  it('starts signed out with no access token', () => {
    renderWithAuth()
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false')
    expect(screen.getByTestId('token')).toHaveTextContent('null')
  })

  it('sets accessToken and isSignedIn after login success', async () => {
    renderWithAuth()
    await act(async () => {
      capturedOnSuccess({ access_token: 'test-token-123', expires_in: 3600 })
    })
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true')
    expect(screen.getByTestId('token')).toHaveTextContent('test-token-123')
  })

  it('clears accessToken and isSignedIn after logout', async () => {
    renderWithAuth()
    await act(async () => {
      capturedOnSuccess({ access_token: 'test-token-123', expires_in: 3600 })
    })
    await userEvent.click(screen.getByText('logout'))
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false')
    expect(screen.getByTestId('token')).toHaveTextContent('null')
  })

  it('restores session from a valid stored token', () => {
    localStorage.setItem('schedule_access_token', 'stored-token')
    localStorage.setItem('schedule_token_expiry', String(Date.now() + 60000))
    renderWithAuth()
    expect(screen.getByTestId('signed-in')).toHaveTextContent('true')
    expect(screen.getByTestId('token')).toHaveTextContent('stored-token')
  })

  it('ignores an expired stored token', () => {
    localStorage.setItem('schedule_access_token', 'expired-token')
    localStorage.setItem('schedule_token_expiry', String(Date.now() - 1000))
    renderWithAuth()
    expect(screen.getByTestId('signed-in')).toHaveTextContent('false')
    expect(screen.getByTestId('token')).toHaveTextContent('null')
  })
})

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TestConsumer />)).toThrow()
    spy.mockRestore()
  })
})
