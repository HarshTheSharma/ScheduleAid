import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App.jsx'

vi.mock('../lib/AssistantHandler.js', () => ({
  getDailyBriefing: vi.fn().mockResolvedValue({ reply: 'Your week is clear.', history: [] }),
  sendMessage: vi.fn(),
  WRITE_TOOLS: new Set(['create_event', 'modify_event', 'delete_event']),
}))

vi.mock('../lib/CalendarHandler.js', () => ({
  getEvents: vi.fn().mockResolvedValue([]),
  getEvent: vi.fn().mockResolvedValue({}),
  getEventsForDay: vi.fn().mockResolvedValue([]),
  findFreeSlots: vi.fn().mockResolvedValue([]),
  findConflicts: vi.fn().mockResolvedValue([]),
  searchEvents: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn(),
  modifyEvent: vi.fn(),
  deleteEvent: vi.fn(),
}))

let capturedOnSuccess

const { mockLogin, mockLogout } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockLogout: vi.fn(),
}))

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: ({ onSuccess }) => {
    capturedOnSuccess = onSuccess
    return mockLogin
  },
  googleLogout: mockLogout,
  GoogleOAuthProvider: ({ children }) => children,
}))

function signIn() {
  capturedOnSuccess({ access_token: 'tok' })
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('shows sign-in screen when not authenticated', () => {
    render(<App />)
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument()
  })

  it('clicking sign-in button triggers login', async () => {
    render(<App />)
    await userEvent.click(screen.getByText('Sign in with Google'))
    expect(mockLogin).toHaveBeenCalled()
  })

  it('shows API key setup after signing in with no saved key', async () => {
    render(<App />)
    signIn()
    expect(await screen.findByText('Connect Your API Key')).toBeInTheDocument()
  })

  it('shows main app after signing in with a saved key', async () => {
    localStorage.setItem('api_key', 'AIza-test-key')
    render(<App />)
    signIn()
    expect(await screen.findByText('Sign out')).toBeInTheDocument()
    expect(screen.queryByText('Connect Your API Key')).not.toBeInTheDocument()
  })

  it('shows main app after entering API key', async () => {
    render(<App />)
    signIn()
    const input = await screen.findByPlaceholderText('AIza…')
    await userEvent.type(input, 'AIza-test-key')
    await userEvent.click(screen.getByText('Local Save'))
    expect(await screen.findByText('Sign out')).toBeInTheDocument()
  })

  it('returns to sign-in screen after signing out', async () => {
    localStorage.setItem('api_key', 'AIza-test-key')
    render(<App />)
    signIn()
    await userEvent.click(await screen.findByText('Sign out'))
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument()
  })
})
