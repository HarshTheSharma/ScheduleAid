import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage, getDailyBriefing, WRITE_TOOLS } from '../lib/AssistantHandler.js'
import * as CalendarHandler from '../lib/CalendarHandler.js'

vi.mock('../lib/CalendarHandler.js', () => ({
  getEvents:      vi.fn(),
  getEventsForDay: vi.fn(),
  findFreeSlots:  vi.fn(),
  findConflicts:  vi.fn(),
  searchEvents:   vi.fn(),
  createEvent:    vi.fn(),
  modifyEvent:    vi.fn(),
  deleteEvent:    vi.fn(),
}))

const API_KEY = 'test-api-key'
const ACCESS_TOKEN = 'test-access-token'

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiResponse(parts) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ candidates: [{ content: { parts } }] }),
  }
}

// stubs fetch so each call returns the next part sequence in order
function mockFetch(...partSequence) {
  const fetchMock = vi.fn()
  partSequence.forEach(parts => fetchMock.mockResolvedValueOnce(apiResponse(parts)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function textPart(text) { return { text } }
function toolCallPart(name, args) { return { functionCall: { name, args } } }

function fetchBody(callIndex = 0) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ── WRITE_TOOLS ───────────────────────────────────────────────────────────────

describe('WRITE_TOOLS', () => {
  it('contains create, modify, and delete', () => {
    expect(WRITE_TOOLS.has('create_event')).toBe(true)
    expect(WRITE_TOOLS.has('modify_event')).toBe(true)
    expect(WRITE_TOOLS.has('delete_event')).toBe(true)
  })

  it('does not contain read tools', () => {
    expect(WRITE_TOOLS.has('get_events')).toBe(false)
    expect(WRITE_TOOLS.has('get_events_for_day')).toBe(false)
    expect(WRITE_TOOLS.has('find_free_slots')).toBe(false)
    expect(WRITE_TOOLS.has('find_conflicts')).toBe(false)
    expect(WRITE_TOOLS.has('search_events')).toBe(false)
  })
})

// ── sendMessage: basic ───────────────────────────────────────────────────────

describe('sendMessage: basic', () => {
  it('returns the text reply when the API responds with no tool calls', async () => {
    mockFetch([textPart('You have nothing at 3pm.')])
    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],'Am I free at 3pm?')
    expect(reply).toBe('You have nothing at 3pm.')
  })

  it('sends the user message as the last content turn', async () => {
    mockFetch([textPart('Hi')])
    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Hello')
    const body = fetchBody()
    const last = body.contents.at(-1)
    expect(last.role).toBe('user')
    expect(last.parts[0].text).toBe('Hello')
  })

  it('sends the API key as a query param and targets generativelanguage.googleapis.com', async () => {
    mockFetch([textPart('Hi')])
    await sendMessage(API_KEY, ACCESS_TOKEN, [], 'Hello')
    const url = fetch.mock.calls[0][0]
    expect(url).toContain('generativelanguage.googleapis.com/v1beta/')
    expect(url).toContain(`key=${API_KEY}`)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('includes the current year in the system prompt', async () => {
    mockFetch([textPart('Hi')])
    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Hello')
    const prompt = fetchBody().systemInstruction.parts[0].text
    expect(prompt).toContain(String(new Date().getFullYear()))
  })

  it('throws when the API returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429,
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } }),
    }))
    await expect(sendMessage(API_KEY, ACCESS_TOKEN, [], 'Hello')).rejects.toThrow('Rate limit exceeded')
  })

  it('appends to existing conversation history', async () => {
    mockFetch([textPart('Yes.')])
    const prior = [
      { role: 'user',  parts: [textPart('Hi')] },
      { role: 'model', parts: [textPart('Hello!')] },
    ]
    const { history } = await sendMessage(API_KEY, ACCESS_TOKEN, prior, 'Am I free?')
    expect(history[0]).toEqual(prior[0])
    expect(history[1]).toEqual(prior[1])
  })
})

// ── sendMessage: single tool chain ──────────────────────────────────────────

describe('sendMessage: single tool chain', () => {
  it('executes a read tool and feeds the result back before getting the final reply', async () => {
    const events = [{ id: 'e1', title: 'Meeting', start: '2026-05-21T10:00:00Z', end: '2026-05-21T11:00:00Z' }]
    CalendarHandler.getEvents.mockResolvedValue(events)
    mockFetch(
      [toolCallPart('get_events', { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })],
      [textPart('You have one meeting at 10am.')],
    )

    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],"What's on today?")

    expect(CalendarHandler.getEvents).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      expect.objectContaining({ from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })
    )
    expect(reply).toBe('You have one meeting at 10am.')
  })

  it('builds history with 4 turns after one tool call: user → model(call) → user(result) → model(text)', async () => {
    CalendarHandler.findConflicts.mockResolvedValue([])
    mockFetch(
      [toolCallPart('find_conflicts', { start: '2026-05-21T15:00:00Z', end: '2026-05-21T16:00:00Z' })],
      [textPart("You're free at 3pm.")],
    )

    const { history } = await sendMessage(API_KEY, ACCESS_TOKEN, [],'Am I free at 3pm?')

    expect(history).toHaveLength(4)
    expect(history[0].role).toBe('user')
    expect(history[1].role).toBe('model')  // tool call
    expect(history[2].role).toBe('user')   // tool result
    expect(history[3].role).toBe('model')  // final text
  })

  it('feeds tool errors back as error responses rather than throwing', async () => {
    CalendarHandler.getEvents.mockRejectedValue(new Error('Calendar unavailable'))
    mockFetch(
      [toolCallPart('get_events', { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })],
      [textPart("Can't reach the calendar right now.")],
    )

    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],"What's on today?")

    // confirms the error is surfaced to the model rather than swallowed
    const toolResult = fetchBody(1).contents.at(-1).parts[0].functionResponse.response
    expect(toolResult.error).toBe('Calendar unavailable')
    expect(reply).toBe("Can't reach the calendar right now.")
  })
})

// ── sendMessage: write tool confirmation ─────────────────────────────────────

describe('sendMessage: write tool confirmation', () => {
  it('calls onPendingAction before executing a write tool', async () => {
    CalendarHandler.createEvent.mockResolvedValue({ id: 'new', title: 'Stand-up' })
    mockFetch(
      [toolCallPart('create_event', { title: 'Stand-up', start: '2026-05-21T09:00:00Z', end: '2026-05-21T09:15:00Z' })],
      [textPart('Stand-up added.')],
    )

    const onPendingAction = vi.fn(({ confirm }) => confirm(true))
    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Add a stand-up', { onPendingAction })

    expect(onPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actions: expect.arrayContaining([
        expect.objectContaining({ name: 'create_event', args: expect.objectContaining({ title: 'Stand-up' }) }),
      ]),
      confirm: expect.any(Function),
    }))
  })

  it('executes the write tool when the user confirms', async () => {
    CalendarHandler.createEvent.mockResolvedValue({ id: 'new', title: 'Stand-up' })
    mockFetch(
      [toolCallPart('create_event', { title: 'Stand-up', start: '2026-05-21T09:00:00Z', end: '2026-05-21T09:15:00Z' })],
      [textPart('Stand-up added.')],
    )

    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Add a stand-up', { onPendingAction: ({ confirm }) => confirm(true) })
    expect(CalendarHandler.createEvent).toHaveBeenCalled()
  })

  it('skips the write tool when the user cancels and feeds a cancelled response back', async () => {
    mockFetch(
      [toolCallPart('create_event', { title: 'Stand-up', start: '2026-05-21T09:00:00Z', end: '2026-05-21T09:15:00Z' })],
      [textPart('OK, I left it off.')],
    )

    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Add a stand-up', { onPendingAction: ({ confirm }) => confirm(false) })

    expect(CalendarHandler.createEvent).not.toHaveBeenCalled()
    const toolResult = fetchBody(1).contents.at(-1).parts[0].functionResponse.response
    expect(toolResult.cancelled).toBe(true)
  })

  it('passes scope to deleteEvent when the assistant includes it', async () => {
    CalendarHandler.deleteEvent.mockResolvedValue(null)
    mockFetch(
      [toolCallPart('delete_event', { eventId: 'series1', scope: 'all' })],
      [textPart('Deleted the entire series.')],
    )
    await sendMessage(API_KEY, ACCESS_TOKEN, [], 'Delete all standups', {
      onPendingAction: ({ confirm }) => confirm(true),
    })
    expect(CalendarHandler.deleteEvent).toHaveBeenCalledWith(ACCESS_TOKEN, 'series1', 'all')
  })

  it('defaults scope to "this" when the assistant omits it', async () => {
    CalendarHandler.deleteEvent.mockResolvedValue(null)
    mockFetch(
      [toolCallPart('delete_event', { eventId: 'evt1' })],
      [textPart('Deleted.')],
    )
    await sendMessage(API_KEY, ACCESS_TOKEN, [], 'Delete the event', {
      onPendingAction: ({ confirm }) => confirm(true),
    })
    expect(CalendarHandler.deleteEvent).toHaveBeenCalledWith(ACCESS_TOKEN, 'evt1', 'this')
  })

  it('does not call onPendingAction for read tools', async () => {
    CalendarHandler.getEvents.mockResolvedValue([])
    mockFetch(
      [toolCallPart('get_events', { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })],
      [textPart('Nothing today.')],
    )

    const onPendingAction = vi.fn(({ confirm }) => confirm(true))
    await sendMessage(API_KEY, ACCESS_TOKEN, [],"What's today?", { onPendingAction })
    expect(onPendingAction).not.toHaveBeenCalled()
  })
})

// ── sendMessage: tool chaining ───────────────────────────────────────────────

describe('sendMessage: tool chaining', () => {
  it('chains a read tool then a write tool across multiple API turns', async () => {
    CalendarHandler.findFreeSlots.mockResolvedValue([{ start: '2026-05-21T14:00:00Z', end: '2026-05-21T17:00:00Z' }])
    CalendarHandler.createEvent.mockResolvedValue({ id: 'new', title: 'Gym' })
    mockFetch(
      [toolCallPart('find_free_slots', { from: '2026-05-21T09:00:00Z', to: '2026-05-21T17:00:00Z', durationMinutes: 60 })],
      [toolCallPart('create_event', { title: 'Gym', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z' })],
      [textPart('Gym scheduled for 2–3pm.')],
    )

    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],'Schedule gym for an hour today', {
      onPendingAction: ({ confirm }) => confirm(true),
    })

    expect(CalendarHandler.findFreeSlots).toHaveBeenCalled()
    expect(CalendarHandler.createEvent).toHaveBeenCalled()
    expect(reply).toBe('Gym scheduled for 2–3pm.')
    expect(fetch).toHaveBeenCalledTimes(3) // one API call per turn
  })

  it('chains search → modify for a "move event" request', async () => {
    const event = { id: 'evt1', title: 'Dentist', start: '2026-05-21T10:00:00Z', end: '2026-05-21T11:00:00Z' }
    CalendarHandler.searchEvents.mockResolvedValue([event])
    CalendarHandler.findConflicts.mockResolvedValue([])
    CalendarHandler.modifyEvent.mockResolvedValue({ ...event, start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z' })
    mockFetch(
      [toolCallPart('search_events', { query: 'Dentist' })],
      [toolCallPart('find_conflicts', { start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z', excludeEventId: 'evt1' })],
      [toolCallPart('modify_event', { eventId: 'evt1', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z' })],
      [textPart('Dentist moved to 2pm.')],
    )

    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],'Move dentist to 2pm', {
      onPendingAction: ({ confirm }) => confirm(true),
    })

    expect(CalendarHandler.searchEvents).toHaveBeenCalled()
    expect(CalendarHandler.findConflicts).toHaveBeenCalled()
    expect(CalendarHandler.modifyEvent).toHaveBeenCalled()
    expect(reply).toBe('Dentist moved to 2pm.')
  })

  it('continues the chain even when one tool in a turn errors', async () => {
    CalendarHandler.findConflicts.mockRejectedValue(new Error('timeout'))
    CalendarHandler.createEvent.mockResolvedValue({ id: 'new', title: 'Lunch' })
    mockFetch(
      [toolCallPart('find_conflicts', { start: '2026-05-21T12:00:00Z', end: '2026-05-21T13:00:00Z' })],
      [toolCallPart('create_event', { title: 'Lunch', start: '2026-05-21T12:00:00Z', end: '2026-05-21T13:00:00Z' })],
      [textPart('Lunch added (conflict check timed out, please verify).')],
    )

    const { reply } = await sendMessage(API_KEY, ACCESS_TOKEN, [],'Add lunch at noon', {
      onPendingAction: ({ confirm }) => confirm(true),
    })

    expect(reply).toContain('Lunch')
  })
})

// ── sendMessage: onProgress ──────────────────────────────────────────────────

describe('sendMessage: onProgress', () => {
  it('calls onProgress for each tool invocation', async () => {
    CalendarHandler.getEvents.mockResolvedValue([])
    CalendarHandler.createEvent.mockResolvedValue({ id: 'new', title: 'Review' })
    mockFetch(
      [toolCallPart('get_events', { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })],
      [toolCallPart('create_event', { title: 'Review', start: '2026-05-21T15:00:00Z', end: '2026-05-21T16:00:00Z' })],
      [textPart('Review added.')],
    )

    const progress = []
    await sendMessage(API_KEY, ACCESS_TOKEN, [],'Schedule a review', {
      onPendingAction: ({ confirm }) => confirm(true),
      onProgress: (info) => progress.push(info.tool),
    })

    expect(progress).toEqual(['get_events', 'create_event'])
  })

  it('does not throw if onProgress is not provided', async () => {
    CalendarHandler.getEvents.mockResolvedValue([])
    mockFetch(
      [toolCallPart('get_events', { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })],
      [textPart('Nothing today.')],
    )
    await expect(sendMessage(API_KEY, ACCESS_TOKEN, [], "What's today?")).resolves.toBeDefined()
  })
})

// ── getDailyBriefing ──────────────────────────────────────────────────────────

describe('getDailyBriefing', () => {
  it('fetches exactly 7 days from the start of today', async () => {
    CalendarHandler.getEvents.mockResolvedValue([])
    mockFetch([textPart('All clear.')])

    await getDailyBriefing(API_KEY, ACCESS_TOKEN)

    const [, { from, to }] = CalendarHandler.getEvents.mock.calls[0]
    const diffMs = new Date(to) - new Date(from)
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('returns reply and history in the same shape as sendMessage', async () => {
    CalendarHandler.getEvents.mockResolvedValue([{ id: 'e1', title: 'Meeting' }])
    mockFetch([textPart('• One meeting tomorrow.')])

    const result = await getDailyBriefing(API_KEY, ACCESS_TOKEN)
    expect(result).toHaveProperty('reply')
    expect(result).toHaveProperty('history')
    expect(result.reply).toBe('• One meeting tomorrow.')
  })

  it('uses a "calendar is clear" prompt when there are no events', async () => {
    CalendarHandler.getEvents.mockResolvedValue([])
    mockFetch([textPart('Your week is clear.')])

    await getDailyBriefing(API_KEY, ACCESS_TOKEN)

    const userMessage = fetchBody(0).contents[0].parts[0].text
    expect(userMessage).toContain('no events')
  })

  it('includes event data in the prompt when events exist', async () => {
    CalendarHandler.getEvents.mockResolvedValue([{ id: 'e1', title: 'Stand-up' }])
    mockFetch([textPart('Stand-up tomorrow.')])

    await getDailyBriefing(API_KEY, ACCESS_TOKEN)

    const userMessage = fetchBody(0).contents[0].parts[0].text
    expect(userMessage).toContain('Stand-up')
  })
})
