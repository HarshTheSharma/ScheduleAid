import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getEvents,
  getEvent,
  getEventsForDay,
  searchEvents,
  findFreeSlots,
  findConflicts,
  createEvent,
  modifyEvent,
  rescheduleEvent,
  deleteEvent,
} from '../lib/CalendarHandler.js'

const TOKEN = 'test-token'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRawEvent(overrides = {}) {
  return {
    id: 'evt1',
    summary: 'Test Event',
    start: { dateTime: '2026-05-21T10:00:00Z' },
    end: { dateTime: '2026-05-21T11:00:00Z' },
    description: '',
    ...overrides,
  }
}

function mockFetch(body, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }))
}

// Captures the URL and options of every fetch call for assertion
function captureFetch(responses) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
    const response = responses.shift()
    calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : undefined })
    return { ok: true, status: 200, json: () => Promise.resolve(response) }
  }))
  return calls
}

beforeEach(() => vi.unstubAllGlobals())

// ── Authorization ─────────────────────────────────────────────────────────────

describe('authorization', () => {
  it('sends Bearer token on every request', async () => {
    const calls = captureFetch([{ items: [] }])
    await getEvents(TOKEN)
    expect(calls[0].opts.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))
    await expect(getEvents(TOKEN)).rejects.toThrow('Network failure')
  })

  it('throws with the API error message on non-2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: () => Promise.resolve({ error: { message: 'Forbidden' } }),
    }))
    await expect(getEvents(TOKEN)).rejects.toThrow('Forbidden')
  })

  it('falls back to a generic message when the error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.reject(new Error('not json')),
    }))
    await expect(getEvents(TOKEN)).rejects.toThrow('Calendar API error 500')
  })
})

// ── metadata encoding ─────────────────────────────────────────────────────────

describe('metadata encoding', () => {
  it('round-trips metadata through description', async () => {
    const metadata = { dueDate: '2026-05-25', priority: 2, flexibility: 1 }
    const calls = captureFetch([makeRawEvent()])
    // echo the description back so parseEvent can decode it
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_, opts) => {
      const sent = JSON.parse(opts.body)
      return { ok: true, status: 200, json: () => Promise.resolve({ ...makeRawEvent(), description: sent.description }) }
    }))

    const created = await createEvent(TOKEN, {
      title: 'Task',
      start: '2026-05-21T10:00:00Z',
      end: '2026-05-21T11:00:00Z',
      description: 'User notes',
      metadata,
    })

    expect(created.description).toBe('User notes')
    expect(created.metadata).toEqual(metadata)
  })

  it('preserves user description text separately from metadata', async () => {
    mockFetch({ items: [makeRawEvent({
      description: 'My notes\n\n<!--schedule-assistant\n{"priority":1,"flexibility":0}\n-->',
    })] })
    const [event] = await getEvents(TOKEN)
    expect(event.description).toBe('My notes')
    expect(event.metadata).toEqual({ priority: 1, flexibility: 0 })
  })

  it('returns empty metadata for events with no marker', async () => {
    mockFetch({ items: [makeRawEvent({ description: 'Plain text' })] })
    const [event] = await getEvents(TOKEN)
    expect(event.metadata).toEqual({})
    expect(event.description).toBe('Plain text')
  })

  it('returns empty metadata for events with no description at all', async () => {
    mockFetch({ items: [makeRawEvent({ description: undefined })] })
    const [event] = await getEvents(TOKEN)
    expect(event.metadata).toEqual({})
    expect(event.description).toBe('')
  })
})

// ── getEvents ─────────────────────────────────────────────────────────────────

describe('getEvents', () => {
  it('returns parsed events', async () => {
    mockFetch({ items: [makeRawEvent()] })
    const events = await getEvents(TOKEN)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Test Event')
    expect(events[0].isAllDay).toBe(false)
  })

  it('uses fallback title when summary is missing', async () => {
    mockFetch({ items: [makeRawEvent({ summary: undefined })] })
    const [event] = await getEvents(TOKEN)
    expect(event.title).toBe('(No title)')
  })

  it('includes timeMin and timeMax when range is provided', async () => {
    const calls = captureFetch([{ items: [] }])
    await getEvents(TOKEN, { from: '2026-05-21T00:00:00Z', to: '2026-05-21T23:59:59Z' })
    expect(calls[0].url).toContain('timeMin=')
    expect(calls[0].url).toContain('timeMax=')
  })

  it('omits timeMin and timeMax when no range is provided', async () => {
    const calls = captureFetch([{ items: [] }])
    await getEvents(TOKEN)
    expect(calls[0].url).not.toContain('timeMin=')
    expect(calls[0].url).not.toContain('timeMax=')
  })

  it('handles all-day events', async () => {
    mockFetch({ items: [makeRawEvent({ start: { date: '2026-05-21' }, end: { date: '2026-05-22' } })] })
    const [event] = await getEvents(TOKEN)
    expect(event.isAllDay).toBe(true)
    expect(event.start).toBe('2026-05-21')
  })

  it('returns empty array when items is missing from response', async () => {
    mockFetch({})
    expect(await getEvents(TOKEN)).toEqual([])
  })
})

// ── getEvent ──────────────────────────────────────────────────────────────────

describe('getEvent', () => {
  it('fetches a single event by id', async () => {
    mockFetch(makeRawEvent({ id: 'abc123' }))
    const event = await getEvent(TOKEN, 'abc123')
    expect(event.id).toBe('abc123')
  })

  it('includes the event id in the request URL', async () => {
    const calls = captureFetch([makeRawEvent({ id: 'xyz' })])
    await getEvent(TOKEN, 'xyz')
    expect(calls[0].url).toContain('xyz')
  })
})

// ── getEventsForDay ───────────────────────────────────────────────────────────

describe('getEventsForDay', () => {
  it('bounds the query to the start and end of the given day', async () => {
    const calls = captureFetch([{ items: [] }])
    await getEventsForDay(TOKEN, '2026-05-21')
    const url = calls[0].url
    const timeMin = new Date(decodeURIComponent(url.match(/timeMin=([^&]+)/)[1]))
    const timeMax = new Date(decodeURIComponent(url.match(/timeMax=([^&]+)/)[1]))
    expect(timeMin.getHours()).toBe(0)
    expect(timeMax.getDate()).toBe(timeMin.getDate())
  })
})

// ── searchEvents ──────────────────────────────────────────────────────────────

describe('searchEvents', () => {
  it('includes q param in request', async () => {
    const calls = captureFetch([{ items: [] }])
    await searchEvents(TOKEN, 'dentist')
    expect(calls[0].url).toContain('q=dentist')
  })

  it('includes optional time range params when provided', async () => {
    const calls = captureFetch([{ items: [] }])
    await searchEvents(TOKEN, 'dentist', { from: '2026-05-21T00:00:00Z' })
    expect(calls[0].url).toContain('timeMin=')
  })
})

// ── findFreeSlots ─────────────────────────────────────────────────────────────

describe('findFreeSlots', () => {
  it('returns the entire range as one slot when the calendar is empty', async () => {
    mockFetch({ items: [] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T17:00:00Z',
      durationMinutes: 30,
    })
    expect(slots).toHaveLength(1)
    expect(slots[0].start).toBe('2026-05-21T09:00:00.000Z')
    expect(slots[0].end).toBe('2026-05-21T17:00:00.000Z')
  })

  it('finds gaps between events', async () => {
    mockFetch({ items: [
      makeRawEvent({ id: 'e1', start: { dateTime: '2026-05-21T10:00:00Z' }, end: { dateTime: '2026-05-21T11:00:00Z' } }),
      makeRawEvent({ id: 'e2', start: { dateTime: '2026-05-21T13:00:00Z' }, end: { dateTime: '2026-05-21T14:00:00Z' } }),
    ] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T17:00:00Z',
      durationMinutes: 30,
    })
    // Gaps: 09–10, 11–13, 14–17
    expect(slots).toHaveLength(3)
  })

  it('returns no slots when the range is fully booked', async () => {
    mockFetch({ items: [
      makeRawEvent({ start: { dateTime: '2026-05-21T09:00:00Z' }, end: { dateTime: '2026-05-21T17:00:00Z' } }),
    ] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T17:00:00Z',
      durationMinutes: 30,
    })
    expect(slots).toHaveLength(0)
  })

  it('handles overlapping events without double-counting the blocked time', async () => {
    mockFetch({ items: [
      makeRawEvent({ id: 'e1', start: { dateTime: '2026-05-21T10:00:00Z' }, end: { dateTime: '2026-05-21T12:00:00Z' } }),
      makeRawEvent({ id: 'e2', start: { dateTime: '2026-05-21T11:00:00Z' }, end: { dateTime: '2026-05-21T13:00:00Z' } }),
    ] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T17:00:00Z',
      durationMinutes: 30,
    })
    // Gaps: 09–10, 13–17 (the overlap 11–12 should not create a false free slot)
    expect(slots).toHaveLength(2)
  })

  it('does not return slots shorter than durationMinutes', async () => {
    mockFetch({ items: [
      makeRawEvent({ id: 'e1', start: { dateTime: '2026-05-21T09:00:00Z' }, end: { dateTime: '2026-05-21T09:15:00Z' } }),
      makeRawEvent({ id: 'e2', start: { dateTime: '2026-05-21T09:20:00Z' }, end: { dateTime: '2026-05-21T10:00:00Z' } }),
    ] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T10:00:00Z',
      durationMinutes: 30,
    })
    expect(slots).toHaveLength(0)
  })

  it('ignores all-day events when calculating free time', async () => {
    mockFetch({ items: [makeRawEvent({ start: { date: '2026-05-21' }, end: { date: '2026-05-22' } })] })
    const slots = await findFreeSlots(TOKEN, {
      from: '2026-05-21T09:00:00Z',
      to: '2026-05-21T17:00:00Z',
      durationMinutes: 60,
    })
    expect(slots).toHaveLength(1)
    expect(slots[0].start).toBe('2026-05-21T09:00:00.000Z')
  })
})

// ── findConflicts ─────────────────────────────────────────────────────────────

describe('findConflicts', () => {
  it('returns timed events that overlap the window', async () => {
    mockFetch({ items: [makeRawEvent()] })
    const conflicts = await findConflicts(TOKEN, {
      start: '2026-05-21T09:00:00Z',
      end: '2026-05-21T12:00:00Z',
    })
    expect(conflicts).toHaveLength(1)
  })

  it('excludes the given event id (used when rescheduling an existing event)', async () => {
    mockFetch({ items: [makeRawEvent({ id: 'evt1' })] })
    const conflicts = await findConflicts(TOKEN, {
      start: '2026-05-21T09:00:00Z',
      end: '2026-05-21T12:00:00Z',
      excludeEventId: 'evt1',
    })
    expect(conflicts).toHaveLength(0)
  })

  it('excludes all-day events since they do not block timed slots', async () => {
    mockFetch({ items: [makeRawEvent({ start: { date: '2026-05-21' }, end: { date: '2026-05-22' } })] })
    const conflicts = await findConflicts(TOKEN, {
      start: '2026-05-21T09:00:00Z',
      end: '2026-05-21T17:00:00Z',
    })
    expect(conflicts).toHaveLength(0)
  })
})

// ── createEvent ───────────────────────────────────────────────────────────────

describe('createEvent', () => {
  it('sends summary, dateTime start/end, and description', async () => {
    const calls = captureFetch([makeRawEvent()])
    await createEvent(TOKEN, {
      title: 'Meeting',
      start: '2026-05-21T10:00:00Z',
      end: '2026-05-21T11:00:00Z',
    })
    expect(calls[0].body.summary).toBe('Meeting')
    expect(calls[0].body.start.dateTime).toBe('2026-05-21T10:00:00')
    expect(calls[0].body.end.dateTime).toBe('2026-05-21T11:00:00')
  })

  it('uses date (not dateTime) fields for all-day events', async () => {
    const calls = captureFetch([makeRawEvent()])
    await createEvent(TOKEN, { title: 'Holiday', start: '2026-05-21', end: '2026-05-22', isAllDay: true })
    expect(calls[0].body.start.date).toBe('2026-05-21')
    expect(calls[0].body.start.dateTime).toBeUndefined()
  })

  it('encodes metadata into the description', async () => {
    const calls = captureFetch([makeRawEvent()])
    await createEvent(TOKEN, {
      title: 'Task',
      start: '2026-05-21T10:00:00Z',
      end: '2026-05-21T11:00:00Z',
      metadata: { priority: 1, flexibility: 0 },
    })
    expect(calls[0].body.description).toContain('schedule-assistant')
    expect(calls[0].body.description).toContain('"priority":1')
  })

  it('returns a parsed event with the correct shape', async () => {
    mockFetch(makeRawEvent({ id: 'new-evt', summary: 'Stand-up' }))
    const event = await createEvent(TOKEN, {
      title: 'Stand-up',
      start: '2026-05-21T10:00:00Z',
      end: '2026-05-21T10:15:00Z',
    })
    expect(event.id).toBe('new-evt')
    expect(event.title).toBe('Stand-up')
    expect(event).toHaveProperty('metadata')
    expect(event).toHaveProperty('isAllDay')
  })
})

// ── modifyEvent ───────────────────────────────────────────────────────────────

describe('modifyEvent', () => {
  function stubModify(existing, patchResponse) {
    const patchCalls = []
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(existing) })
      .mockImplementationOnce(async (url, opts) => {
        patchCalls.push({ url, body: JSON.parse(opts.body), method: opts.method })
        return { ok: true, status: 200, json: () => Promise.resolve(patchResponse ?? existing) }
      })
    )
    return patchCalls
  }

  it('uses PATCH method', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { title: 'Updated' })
    expect(calls[0].method).toBe('PATCH')
  })

  it('includes the event id in the PATCH URL', async () => {
    const calls = stubModify(makeRawEvent({ id: 'target-id' }))
    await modifyEvent(TOKEN, 'target-id', { title: 'Updated' })
    expect(calls[0].url).toContain('target-id')
  })

  it('only sends the fields that changed', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { title: 'New Title' })
    expect(calls[0].body.summary).toBe('New Title')
    expect(calls[0].body.start).toBeUndefined()
    expect(calls[0].body.end).toBeUndefined()
    expect(calls[0].body.description).toBeUndefined()
  })

  it('updates start and end times', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', {
      start: '2026-05-21T14:00:00Z',
      end: '2026-05-21T15:00:00Z',
    })
    expect(calls[0].body.start.dateTime).toBe('2026-05-21T14:00:00Z')
    expect(calls[0].body.end.dateTime).toBe('2026-05-21T15:00:00Z')
  })

  it('deep-merges metadata without wiping unrelated fields', async () => {
    const existing = makeRawEvent({
      description: 'Notes\n\n<!--schedule-assistant\n{"priority":3,"flexibility":1,"dueDate":"2026-06-01"}\n-->',
    })
    const calls = stubModify(existing)
    await modifyEvent(TOKEN, 'evt1', { metadata: { priority: 1 } })

    const stored = JSON.parse(
      calls[0].body.description.match(/<!--schedule-assistant\n([\s\S]+?)\n-->/)[1]
    )
    expect(stored.priority).toBe(1)
    expect(stored.flexibility).toBe(1)
    expect(stored.dueDate).toBe('2026-06-01')
  })

  it('updates description text without touching existing metadata', async () => {
    const existing = makeRawEvent({
      description: 'Old notes\n\n<!--schedule-assistant\n{"priority":2}\n-->',
    })
    const calls = stubModify(existing)
    await modifyEvent(TOKEN, 'evt1', { description: 'New notes' })

    expect(calls[0].body.description).toContain('New notes')
    expect(calls[0].body.description).toContain('"priority":2')
  })
})

// ── rescheduleEvent ───────────────────────────────────────────────────────────

describe('rescheduleEvent', () => {
  function stubReschedule(existing) {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(existing) }) // GET
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(existing) }) // GET inside modifyEvent
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(existing) }) // PATCH
    )
  }

  it('preserves the original duration when rescheduling', async () => {
    const existing = makeRawEvent({
      start: { dateTime: '2026-05-21T10:00:00Z' },
      end:   { dateTime: '2026-05-21T11:30:00Z' }, // 90 min
    })
    stubReschedule(existing)
    const calls = []
    const origFetch = global.fetch
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts?.body ? JSON.parse(opts.body) : undefined })
      return origFetch(url, opts)
    }))
    // Re-stub cleanly
    vi.unstubAllGlobals()
    stubReschedule(existing)
    const patchCalls = []
    const inner = global.fetch
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      if (opts.method === 'PATCH') patchCalls.push(JSON.parse(opts.body))
      return inner(url, opts)
    }))
    vi.unstubAllGlobals()

    // Simplified: just verify the computed end via captureFetch
    const fetchCalls = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      fetchCalls.push({ url, method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : undefined })
      return { ok: true, status: 200, json: () => Promise.resolve(existing) }
    }))

    await rescheduleEvent(TOKEN, 'evt1', '2026-05-21T14:00:00Z')

    const patch = fetchCalls.find(c => c.method === 'PATCH')
    expect(patch.body.start.dateTime).toBe('2026-05-21T14:00:00Z')
    expect(patch.body.end.dateTime).toBe('2026-05-21T15:30:00.000Z') // 90 min preserved
  })

  it('sends a PATCH request with the new start and computed end', async () => {
    const existing = makeRawEvent({
      start: { dateTime: '2026-05-21T09:00:00Z' },
      end:   { dateTime: '2026-05-21T10:00:00Z' }, // 60 min
    })
    const fetchCalls = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      fetchCalls.push({ url, method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : undefined })
      return { ok: true, status: 200, json: () => Promise.resolve(existing) }
    }))

    await rescheduleEvent(TOKEN, 'evt1', '2026-05-22T15:00:00Z')

    const patch = fetchCalls.find(c => c.method === 'PATCH')
    expect(patch.body.start.dateTime).toBe('2026-05-22T15:00:00Z')
    expect(patch.body.end.dateTime).toBe('2026-05-22T16:00:00.000Z')
  })
})

// ── deleteEvent ───────────────────────────────────────────────────────────────

function stubDelete(responses) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
    const r = responses.shift() ?? { status: 204, body: null }
    calls.push({ url, method: opts.method, body: opts?.body ? JSON.parse(opts.body) : undefined })
    return { ok: true, status: r.status, json: () => Promise.resolve(r.body) }
  }))
  return calls
}

describe('deleteEvent', () => {
  it('sends a DELETE request for scope="this" (default)', async () => {
    const calls = stubDelete([{ status: 204, body: null }])
    await deleteEvent(TOKEN, 'evt1')
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url).toContain('evt1')
  })

  it('includes the event id in the DELETE URL', async () => {
    const calls = stubDelete([{ status: 204, body: null }])
    await deleteEvent(TOKEN, 'my-event-id')
    expect(calls[0].url).toContain('my-event-id')
  })
})

describe('deleteEvent: recurring', () => {
  it('scope="all" fetches the event then deletes via recurringEventId', async () => {
    const calls = stubDelete([
      { status: 200, body: makeRawEvent({ id: 'inst1', recurringEventId: 'series1' }) },
      { status: 204, body: null },
    ])
    await deleteEvent(TOKEN, 'inst1', 'all')
    expect(calls[0].method).toBe('GET')
    expect(calls[1].method).toBe('DELETE')
    expect(calls[1].url).toContain('series1')
    expect(calls[1].url).not.toContain('inst1')
  })

  it('scope="all" on a non-recurring event deletes the event itself', async () => {
    const calls = stubDelete([
      { status: 200, body: makeRawEvent({ id: 'standalone' }) },
      { status: 204, body: null },
    ])
    await deleteEvent(TOKEN, 'standalone', 'all')
    expect(calls[1].url).toContain('standalone')
  })

  it('scope="following" patches master recurrence then deletes the instance', async () => {
    const masterRaw = {
      id: 'series1',
      summary: 'Weekly Standup',
      start: { dateTime: '2026-05-19T10:00:00Z' },
      end:   { dateTime: '2026-05-19T10:30:00Z' },
      description: '',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
    }
    const instanceRaw = makeRawEvent({
      id: 'inst1',
      recurringEventId: 'series1',
      originalStartTime: { dateTime: '2026-05-26T10:00:00Z' },
    })
    const calls = stubDelete([
      { status: 200, body: instanceRaw },   // GET instance
      { status: 200, body: masterRaw },     // GET master
      { status: 200, body: masterRaw },     // PATCH master
      { status: 204, body: null },          // DELETE instance
    ])
    await deleteEvent(TOKEN, 'inst1', 'following')

    const patch = calls[2]
    expect(patch.method).toBe('PATCH')
    expect(patch.url).toContain('series1')
    expect(patch.body.recurrence[0]).toContain('UNTIL=')
    expect(patch.body.recurrence[0]).toContain('20260526T')  // one second before the May 26 instance

    expect(calls[3].method).toBe('DELETE')
    expect(calls[3].url).toContain('inst1')
  })

  it('scope="following" on a non-recurring event just deletes it', async () => {
    const calls = stubDelete([
      { status: 200, body: makeRawEvent({ id: 'standalone' }) },
      { status: 204, body: null },
    ])
    await deleteEvent(TOKEN, 'standalone', 'following')
    expect(calls[1].method).toBe('DELETE')
    expect(calls[1].url).toContain('standalone')
  })

  it('parseEvent exposes recurringEventId when present', async () => {
    mockFetch({ items: [makeRawEvent({ recurringEventId: 'series1' })] })
    const [event] = await getEvents(TOKEN)
    expect(event.recurringEventId).toBe('series1')
  })

  it('parseEvent omits recurringEventId for non-recurring events', async () => {
    mockFetch({ items: [makeRawEvent()] })
    const [event] = await getEvents(TOKEN)
    expect(event.recurringEventId).toBeUndefined()
  })
})

// ── createEvent: recurrence ───────────────────────────────────────────────────

describe('createEvent: recurrence', () => {
  it('sends recurrence as a single-element array when provided', async () => {
    const rrule = 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    const calls = captureFetch([makeRawEvent({ recurrence: [rrule] })])
    await createEvent(TOKEN, {
      title: 'Standup',
      start: '2026-05-25T10:00:00Z',
      end:   '2026-05-25T10:15:00Z',
      recurrence: rrule,
    })
    expect(calls[0].body.recurrence).toEqual([rrule])
  })

  it('omits the recurrence field entirely when not provided', async () => {
    const calls = captureFetch([makeRawEvent()])
    await createEvent(TOKEN, {
      title: 'One-off',
      start: '2026-05-25T10:00:00Z',
      end:   '2026-05-25T11:00:00Z',
    })
    expect(calls[0].body.recurrence).toBeUndefined()
  })

  it('supports COUNT-based recurrence', async () => {
    const rrule = 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=6'
    const calls = captureFetch([makeRawEvent({ recurrence: [rrule] })])
    await createEvent(TOKEN, {
      title: 'Sprint retro',
      start: '2026-05-25T14:00:00Z',
      end:   '2026-05-25T15:00:00Z',
      recurrence: rrule,
    })
    expect(calls[0].body.recurrence[0]).toContain('COUNT=6')
  })

  it('supports UNTIL-based recurrence', async () => {
    const rrule = 'RRULE:FREQ=DAILY;UNTIL=20261231'
    const calls = captureFetch([makeRawEvent({ recurrence: [rrule] })])
    await createEvent(TOKEN, {
      title: 'Daily check-in',
      start: '2026-05-25T09:00:00Z',
      end:   '2026-05-25T09:15:00Z',
      recurrence: rrule,
    })
    expect(calls[0].body.recurrence[0]).toContain('UNTIL=20261231')
  })

  it('supports monthly recurrence', async () => {
    const rrule = 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1'
    const calls = captureFetch([makeRawEvent({ recurrence: [rrule] })])
    await createEvent(TOKEN, {
      title: 'Monthly review',
      start: '2026-05-01T10:00:00Z',
      end:   '2026-05-01T11:00:00Z',
      recurrence: rrule,
    })
    expect(calls[0].body.recurrence[0]).toContain('FREQ=MONTHLY')
  })

  it('returns a parsed event after creating a recurring one', async () => {
    const rrule = 'RRULE:FREQ=WEEKLY;BYDAY=MO'
    mockFetch(makeRawEvent({ id: 'recurring-evt', summary: 'Standup', recurrence: [rrule] }))
    const event = await createEvent(TOKEN, {
      title: 'Standup',
      start: '2026-05-25T10:00:00Z',
      end:   '2026-05-25T10:15:00Z',
      recurrence: rrule,
    })
    expect(event.id).toBe('recurring-evt')
    expect(event.title).toBe('Standup')
  })

  it('throws if the API response is missing the recurrence field', async () => {
    mockFetch(makeRawEvent())
    await expect(createEvent(TOKEN, {
      title: 'Standup',
      start: '2026-05-25T10:00:00Z',
      end:   '2026-05-25T10:15:00Z',
      recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
    })).rejects.toThrow('did not store the recurrence rule')
  })
})

// ── modifyEvent: recurrence ───────────────────────────────────────────────────

describe('modifyEvent: recurrence', () => {
  function stubModify(existing, patchResponse) {
    const patchCalls = []
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(existing) })
      .mockImplementationOnce(async (url, opts) => {
        patchCalls.push({ url, body: JSON.parse(opts.body), method: opts.method })
        return { ok: true, status: 200, json: () => Promise.resolve(patchResponse ?? existing) }
      })
    )
    return patchCalls
  }

  it('sends recurrence as a single-element array when updating the rule', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { recurrence: 'RRULE:FREQ=DAILY' })
    expect(calls[0].body.recurrence).toEqual(['RRULE:FREQ=DAILY'])
  })

  it('sends an empty array to clear recurrence when passed an empty string', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { recurrence: '' })
    expect(calls[0].body.recurrence).toEqual([])
  })

  it('does not include recurrence in the PATCH when not provided', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { title: 'Renamed' })
    expect(calls[0].body.recurrence).toBeUndefined()
  })

  it('can change recurrence pattern without touching title or time', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH' })
    expect(calls[0].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU,TH'])
    expect(calls[0].body.summary).toBeUndefined()
    expect(calls[0].body.start).toBeUndefined()
  })

  it('can update recurrence and title in the same call', async () => {
    const calls = stubModify(makeRawEvent())
    await modifyEvent(TOKEN, 'evt1', { title: 'New Name', recurrence: 'RRULE:FREQ=MONTHLY' })
    expect(calls[0].body.summary).toBe('New Name')
    expect(calls[0].body.recurrence).toEqual(['RRULE:FREQ=MONTHLY'])
  })

  it('preserves existing metadata when only recurrence changes', async () => {
    const existing = makeRawEvent({
      description: 'Notes\n\n<!--schedule-assistant\n{"priority":2,"dueDate":"2026-06-01"}\n-->',
    })
    const calls = stubModify(existing)
    await modifyEvent(TOKEN, 'evt1', { recurrence: 'RRULE:FREQ=WEEKLY' })
    expect(calls[0].body.description).toBeUndefined()
    expect(calls[0].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY'])
  })
})
