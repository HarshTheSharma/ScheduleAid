const BASE_URL = 'https://www.googleapis.com/calendar/v3'

// Metadata is encoded as a JSON block at the end of an event's description.
// This keeps it invisible to regular Calendar users while remaining
// machine-readable. User-visible description text is preserved above it.
const META_MARKER = '\n\n<!--schedule-assistant'
const META_END = '-->'

function encodeDescription(text, metadata) {
  const base = text ?? ''
  if (!metadata || Object.keys(metadata).length === 0) return base
  return `${base}${META_MARKER}\n${JSON.stringify(metadata)}\n${META_END}`
}

function decodeDescription(raw) {
  if (!raw) return { text: '', metadata: {} }
  const markerIdx = raw.indexOf(META_MARKER)
  if (markerIdx === -1) return { text: raw, metadata: {} }
  const text = raw.slice(0, markerIdx)
  const jsonStr = raw.slice(markerIdx + META_MARKER.length, raw.lastIndexOf(META_END)).trim()
  try {
    return { text, metadata: JSON.parse(jsonStr) }
  } catch {
    return { text: raw, metadata: {} }
  }
}

function parseEvent(raw) {
  const { text, metadata } = decodeDescription(raw.description)
  return {
    id: raw.id,
    title: raw.summary ?? '(No title)',
    start: raw.start?.dateTime ?? raw.start?.date,
    end: raw.end?.dateTime ?? raw.end?.date,
    isAllDay: !raw.start?.dateTime,
    description: text,
    metadata,
    ...(raw.recurrence        && { recurrence: raw.recurrence }),
    ...(raw.recurringEventId  && { recurringEventId: raw.recurringEventId }),
    raw,
  }
}

function capRecurrenceUntil(recurrence, beforeIso) {
  const isDate = !beforeIso.includes('T')
  let until
  if (isDate) {
    const d = new Date(beforeIso)
    d.setDate(d.getDate() - 1)
    until = d.toISOString().slice(0, 10).replace(/-/g, '')       // YYYYMMDD
  } else {
    const d = new Date(beforeIso)
    d.setSeconds(d.getSeconds() - 1)
    until = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') // YYYYMMDDTHHMMSSZ
  }
  return recurrence.map(rule =>
    rule.startsWith('RRULE:')
      ? rule.replace(/;UNTIL=[^;]*/i, '').replace(/;COUNT=\d+/i, '') + `;UNTIL=${until}`
      : rule
  )
}

async function request(method, path, accessToken, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message ?? `Calendar API error ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getEvents(accessToken, { from, to, maxResults = 250 } = {}) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
    ...(from && { timeMin: new Date(from).toISOString() }),
    ...(to && { timeMax: new Date(to).toISOString() }),
  })
  const data = await request('GET', `/calendars/primary/events?${params}`, accessToken)
  return (data.items ?? []).map(parseEvent)
}

export async function getEvent(accessToken, eventId) {
  const raw = await request('GET', `/calendars/primary/events/${eventId}`, accessToken)
  return parseEvent(raw)
}

export async function getEventsForDay(accessToken, date) {
  const d = new Date(date)
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString()
  return getEvents(accessToken, { from, to })
}

export async function searchEvents(accessToken, query, { from, to } = {}) {
  const params = new URLSearchParams({
    q: query,
    singleEvents: 'true',
    orderBy: 'startTime',
    ...(from && { timeMin: new Date(from).toISOString() }),
    ...(to && { timeMax: new Date(to).toISOString() }),
  })
  const data = await request('GET', `/calendars/primary/events?${params}`, accessToken)
  return (data.items ?? []).map(parseEvent)
}

// ── Scheduling helpers ────────────────────────────────────────────────────────

export async function findFreeSlots(accessToken, { from, to, durationMinutes }) {
  const events = await getEvents(accessToken, { from, to })
  const timedEvents = events
    .filter(e => !e.isAllDay)
    .sort((a, b) => new Date(a.start) - new Date(b.start))

  const slots = []
  let cursor = new Date(from)
  const rangeEnd = new Date(to)
  const minMs = durationMinutes * 60 * 1000

  for (const event of timedEvents) {
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    if (eventStart - cursor >= minMs) {
      slots.push({ start: cursor.toISOString(), end: eventStart.toISOString() })
    }
    if (eventEnd > cursor) cursor = eventEnd
  }

  if (rangeEnd - cursor >= minMs) {
    slots.push({ start: cursor.toISOString(), end: rangeEnd.toISOString() })
  }

  return slots
}

export async function findConflicts(accessToken, { start, end, excludeEventId } = {}) {
  const events = await getEvents(accessToken, { from: start, to: end })
  return events.filter(e => !e.isAllDay && e.id !== excludeEventId)
}

// ── Write ─────────────────────────────────────────────────────────────────────

function stripOffset(iso) {
  // Convert "2026-05-26T18:00:00-07:00" or "2026-05-26T18:00:00Z" to "2026-05-26T18:00:00"
  // Google Calendar docs show local datetime + separate timeZone field for recurring events
  return iso?.replace(/([+-]\d{2}:\d{2}|Z)$/, '') ?? iso
}

export async function createEvent(accessToken, {
  title,
  start,
  end,
  description = '',
  metadata = {},
  isAllDay = false,
  recurrence,
}) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timeFields = isAllDay
    ? { start: { date: start }, end: { date: end } }
    : {
        start: { dateTime: stripOffset(start), timeZone: tz },
        end:   { dateTime: stripOffset(end),   timeZone: tz },
      }

  const raw = await request('POST', '/calendars/primary/events', accessToken, {
    summary: title,
    description: encodeDescription(description, metadata),
    ...timeFields,
    ...(recurrence && { recurrence: [recurrence] }),
  })
  const parsed = parseEvent(raw)
  if (recurrence && !parsed.recurrence?.length) {
    throw new Error('Google Calendar accepted the event but did not store the recurrence rule. Please try again.')
  }
  return parsed
}

// metadata is deep-merged so a partial update (e.g. priority only) doesn't wipe dueDate or flexibility
export async function modifyEvent(accessToken, eventId, updates) {
  const current = await getEvent(accessToken, eventId)
  const patch = {}

  if (updates.title !== undefined) patch.summary = updates.title

  const needsDescription = updates.description !== undefined || updates.metadata !== undefined
  if (needsDescription) {
    patch.description = encodeDescription(
      updates.description ?? current.description,
      { ...current.metadata, ...updates.metadata },
    )
  }

  if (updates.start !== undefined) {
    const allDay = updates.isAllDay ?? current.isAllDay
    patch.start = allDay ? { date: updates.start } : { dateTime: updates.start }
  }

  if (updates.end !== undefined) {
    const allDay = updates.isAllDay ?? current.isAllDay
    patch.end = allDay ? { date: updates.end } : { dateTime: updates.end }
  }

  if (updates.recurrence !== undefined) {
    patch.recurrence = updates.recurrence ? [updates.recurrence] : []
  }

  const raw = await request('PATCH', `/calendars/primary/events/${eventId}`, accessToken, patch)
  return parseEvent(raw)
}

export async function rescheduleEvent(accessToken, eventId, newStart) {
  const current = await getEvent(accessToken, eventId)
  const duration = new Date(current.end) - new Date(current.start)
  const newEnd = new Date(new Date(newStart).getTime() + duration).toISOString()
  return modifyEvent(accessToken, eventId, { start: newStart, end: newEnd })
}

export async function deleteEvent(accessToken, eventId, scope = 'this') {
  if (scope === 'all') {
    const raw = await request('GET', `/calendars/primary/events/${eventId}`, accessToken)
    const seriesId = raw.recurringEventId ?? eventId
    await request('DELETE', `/calendars/primary/events/${seriesId}`, accessToken)
    return
  }

  if (scope === 'following') {
    const raw = await request('GET', `/calendars/primary/events/${eventId}`, accessToken)
    const seriesId = raw.recurringEventId
    if (!seriesId) {
      await request('DELETE', `/calendars/primary/events/${eventId}`, accessToken)
      return
    }
    const master = await request('GET', `/calendars/primary/events/${seriesId}`, accessToken)
    const originalStart = raw.originalStartTime?.dateTime ?? raw.originalStartTime?.date
    if (originalStart && master.recurrence?.length) {
      await request('PATCH', `/calendars/primary/events/${seriesId}`, accessToken, {
        recurrence: capRecurrenceUntil(master.recurrence, originalStart),
      })
    }
    try {
      await request('DELETE', `/calendars/primary/events/${eventId}`, accessToken)
    } catch {
      // instance may already be excluded by the recurrence update
    }
    return
  }

  await request('DELETE', `/calendars/primary/events/${eventId}`, accessToken)
}
