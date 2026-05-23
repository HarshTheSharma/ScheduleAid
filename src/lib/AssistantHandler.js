import {
  getEvents,
  getEventsForDay,
  findFreeSlots,
  findConflicts,
  searchEvents,
  createEvent,
  modifyEvent,
  rescheduleEvent,
  deleteEvent,
} from './CalendarHandler.js'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'models/gemini-3.1-flash-lite'

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

  return `You are ScheduleAI'd, a sharp proactive scheduling assistant with direct access to the user's Google Calendar.

Your job is to help the user manage their time well. Not just execute requests, but actively look out for them.

## Timezone and current time
The user's local timezone is ${timezone}.
The current local date and time is ${dateStr} at ${timeStr}.
All ISO 8601 datetimes you pass to tools MUST be expressed in this timezone using the offset format (e.g. if the user says "3pm" and their timezone is America/New_York at UTC-4, pass "2026-05-22T15:00:00-04:00", not "2026-05-22T19:00:00Z"). Never silently shift times to UTC.

## Scheduling preference
Always default to scheduling events in the future relative to the current time above. If the user says "schedule a meeting" with no date, pick the next available future slot. Only place something in the past if the user explicitly asks (e.g. "log that I did X yesterday").

## Chaining tools
Use as many tool calls as you need to fully complete a request. Never stop mid-task to ask for information you can get from the calendar yourself. Keep chaining until the job is done, then reply once.

Examples of expected chains:
- "Am I free at 3pm?" → find_conflicts(3pm window) → reply
- "Free up my afternoon" → get_events_for_day → find_free_slots on upcoming days → modify_event for each flexible event → reply with a summary of what moved
- "Move X to now" → search_events(X) → find_conflicts(now, now+duration) → reschedule_event(id, newStart) → reply
- "I made progress on X, continue tomorrow" → search_events(X) → modify_event(add progress note) → find_free_slots(tomorrow) → create_event(follow-up, linkedEventId=X.id) → reply
- "Schedule Y for an hour this week" → find_free_slots(this week, 60 min) → propose options → after user picks → find_conflicts → create_event → reply

Read tools (get_events, get_events_for_day, find_free_slots, find_conflicts, search_events) run silently; chain them freely.
Write tools (create_event, modify_event, delete_event) require user confirmation; the system will pause and ask before executing.

## How to work
- Never assume a slot is free. Always check with find_conflicts or find_free_slots first.
- Always find the event with get_events or search_events before modifying or deleting it.
- When moving or rescheduling an event, ALWAYS use reschedule_event. Never create_event + delete_event, and never modify_event just to change the time. reschedule_event preserves duration automatically.
- When moving an event, preserve its original duration unless told otherwise.
- When creating a task (not a meeting), ask about priority (1 = urgent, 5 = low), flexibility (0 = fixed, 1 = movable), and due date if not provided.

## When to push back
- If a day is already packed, say so and suggest alternatives.
- If a task has a near due date but no time blocked for it, flag it.
- If back-to-back events leave no buffer, mention it.
- If a request seems unrealistic given the schedule, be honest.

## How to reply
Your reply to the user should only ever be the final outcome. Never include your reasoning or intermediate steps.
- After reading: answer the question directly in one or two sentences.
- After writing: confirm what changed in one sentence ("Moved dentist to Tuesday at 2pm").
- When proposing slots: offer 2–3 options with a brief reason for each.
- No filler phrases. No "Great question!" or "Certainly!".

## Recurring events
When an event has a recurringEventId field, it is one instance of a repeating series.

Creating recurring events: use the recurrence parameter with a valid RRULE string.
Common patterns:
- Daily: RRULE:FREQ=DAILY
- Weekly on specific days: RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
- Every two weeks: RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO
- Monthly on a date: RRULE:FREQ=MONTHLY;BYMONTHDAY=15
- N times total: append ;COUNT=N (e.g. RRULE:FREQ=DAILY;COUNT=5)
- Until a date: append ;UNTIL=YYYYMMDD (e.g. RRULE:FREQ=WEEKLY;UNTIL=20261231)

Modifying a recurring series: use modify_event with the recurringEventId (not the instance ID) to change the whole series. Use delete_event scope to remove occurrences.

Before deleting, always clarify scope unless the user made it unambiguous:
- "delete just today's standup" → scope='this'
- "delete this and all future standups" → scope='following'
- "delete all my standups" / "cancel the whole series" → scope='all'

## What you know about events
Events may carry metadata: dueDate, priority (1–5), flexibility (0 = fixed, 1 = movable), progress (current status note), linkedEventId (links a follow-up to its original).
Never move a fixed event. Prefer moving lower-priority flexible ones first.`
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_events',
      description: 'Fetch calendar events within a time range, sorted by start time.',
      parameters: {
        type: 'OBJECT',
        properties: {
          from: { type: 'STRING', description: 'ISO 8601 start datetime (e.g. 2026-05-21T00:00:00Z)' },
          to:   { type: 'STRING', description: 'ISO 8601 end datetime' },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'get_events_for_day',
      description: 'Fetch all events on a specific calendar date.',
      parameters: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'Date string e.g. 2026-05-21' },
        },
        required: ['date'],
      },
    },
    {
      name: 'find_free_slots',
      description: 'Find unbooked time windows of at least the given duration within a range. Use this before proposing a new time slot.',
      parameters: {
        type: 'OBJECT',
        properties: {
          from:            { type: 'STRING', description: 'ISO 8601 start of search range' },
          to:              { type: 'STRING', description: 'ISO 8601 end of search range' },
          durationMinutes: { type: 'NUMBER', description: 'Minimum slot length in minutes' },
        },
        required: ['from', 'to', 'durationMinutes'],
      },
    },
    {
      name: 'find_conflicts',
      description: 'Return any events that overlap a proposed time window. Call this before creating or moving an event.',
      parameters: {
        type: 'OBJECT',
        properties: {
          start:          { type: 'STRING', description: 'ISO 8601 start of the proposed window' },
          end:            { type: 'STRING', description: 'ISO 8601 end of the proposed window' },
          excludeEventId: { type: 'STRING', description: 'Event ID to exclude (use when rescheduling an existing event)' },
        },
        required: ['start', 'end'],
      },
    },
    {
      name: 'search_events',
      description: 'Full-text search over event titles and descriptions. Use to find a specific event before modifying or deleting it.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Search term' },
          from:  { type: 'STRING', description: 'Optional ISO 8601 start bound' },
          to:    { type: 'STRING', description: 'Optional ISO 8601 end bound' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_event',
      description: 'Create a new calendar event. Only call this after confirming the slot is free and the user has agreed to the time.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title:       { type: 'STRING', description: 'Event title' },
          start:       { type: 'STRING', description: 'ISO 8601 start datetime' },
          end:         { type: 'STRING', description: 'ISO 8601 end datetime' },
          description: { type: 'STRING', description: 'Optional user-visible description' },
          recurrence:  { type: 'STRING', description: 'RRULE string for repeating events, e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" or "RRULE:FREQ=DAILY;COUNT=5". Omit for one-off events.' },
          priority:      { type: 'NUMBER', description: '1 (urgent) to 5 (low). Ask the user if unsure.' },
          flexibility:   { type: 'NUMBER', description: '0 = fixed, 1 = can be moved. Ask the user if unsure.' },
          dueDate:       { type: 'STRING', description: 'Hard deadline date (YYYY-MM-DD), if any' },
          progress:      { type: 'STRING', description: 'Free-text note on current status or progress, e.g. "Completed intro section"' },
          linkedEventId: { type: 'STRING', description: 'ID of a related event, e.g. the original when creating a follow-up' },
        },
        required: ['title', 'start', 'end'],
      },
    },
    {
      name: 'modify_event',
      description: 'Update an existing event, including rescheduling (moving) it to a new time. Only provide the fields that should change; others are preserved. Always use this to move an event, never create+delete. To modify a recurring series, use the recurringEventId as the eventId.',
      parameters: {
        type: 'OBJECT',
        properties: {
          eventId:     { type: 'STRING', description: 'The event ID to modify. For recurring series changes, use the recurringEventId.' },
          title:       { type: 'STRING', description: 'New title' },
          start:       { type: 'STRING', description: 'New ISO 8601 start datetime' },
          end:         { type: 'STRING', description: 'New ISO 8601 end datetime' },
          description: { type: 'STRING', description: 'New description text' },
          recurrence:  { type: 'STRING', description: 'New RRULE string to change the recurrence pattern, e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO". Pass empty string to remove recurrence.' },
          priority:      { type: 'NUMBER', description: 'New priority (1–5)' },
          flexibility:   { type: 'NUMBER', description: 'New flexibility (0 or 1)' },
          dueDate:       { type: 'STRING', description: 'New due date (YYYY-MM-DD)' },
          progress:      { type: 'STRING', description: 'Updated progress note' },
          linkedEventId: { type: 'STRING', description: 'ID of a related event' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'reschedule_event',
      description: 'Move an event to a new start time, automatically preserving its original duration. Use this instead of modify_event whenever the user wants to reschedule or move an event to a different time.',
      parameters: {
        type: 'OBJECT',
        properties: {
          eventId:  { type: 'STRING', description: 'The event ID to reschedule' },
          newStart: { type: 'STRING', description: 'New ISO 8601 start datetime' },
        },
        required: ['eventId', 'newStart'],
      },
    },
    {
      name: 'delete_event',
      description: 'Permanently delete a calendar event. For recurring events, use scope to control which occurrences are removed. Always clarify scope with the user before calling.',
      parameters: {
        type: 'OBJECT',
        properties: {
          eventId: { type: 'STRING', description: 'The event ID to delete' },
          scope:   { type: 'STRING', description: '"this" (default) = only this occurrence, "following" = this and all future occurrences, "all" = the entire recurring series' },
        },
        required: ['eventId'],
      },
    },
  ],
}]

// ── Tool executor ─────────────────────────────────────────────────────────────

export const WRITE_TOOLS = new Set(['create_event', 'modify_event', 'reschedule_event', 'delete_event'])

async function executeTool(name, args, accessToken) {
  switch (name) {
    case 'get_events':
      return getEvents(accessToken, { from: args.from, to: args.to })

    case 'get_events_for_day':
      return getEventsForDay(accessToken, args.date)

    case 'find_free_slots':
      return findFreeSlots(accessToken, {
        from: args.from,
        to: args.to,
        durationMinutes: args.durationMinutes,
      })

    case 'find_conflicts':
      return findConflicts(accessToken, {
        start: args.start,
        end: args.end,
        excludeEventId: args.excludeEventId,
      })

    case 'search_events':
      return searchEvents(accessToken, args.query, { from: args.from, to: args.to })

    case 'create_event':
      return createEvent(accessToken, {
        title: args.title,
        start: args.start,
        end: args.end,
        description: args.description ?? '',
        ...(args.recurrence !== undefined && { recurrence: args.recurrence }),
        metadata: {
          ...(args.priority      !== undefined && { priority: args.priority }),
          ...(args.flexibility   !== undefined && { flexibility: args.flexibility }),
          ...(args.dueDate       !== undefined && { dueDate: args.dueDate }),
          ...(args.progress      !== undefined && { progress: args.progress }),
          ...(args.linkedEventId !== undefined && { linkedEventId: args.linkedEventId }),
        },
      })

    case 'modify_event': {
      const metadataKeys = ['priority', 'flexibility', 'dueDate', 'progress', 'linkedEventId']
      const hasMetadata = metadataKeys.some(k => args[k] !== undefined)
      return modifyEvent(accessToken, args.eventId, {
        ...(args.title       !== undefined && { title: args.title }),
        ...(args.start       !== undefined && { start: args.start }),
        ...(args.end         !== undefined && { end: args.end }),
        ...(args.description !== undefined && { description: args.description }),
        ...(args.recurrence  !== undefined && { recurrence: args.recurrence }),
        ...(hasMetadata && {
          metadata: Object.fromEntries(
            metadataKeys.filter(k => args[k] !== undefined).map(k => [k, args[k]])
          ),
        }),
      })
    }

    case 'reschedule_event':
      return rescheduleEvent(accessToken, args.eventId, args.newStart)

    case 'delete_event':
      return deleteEvent(accessToken, args.eventId, args.scope ?? 'this')

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Core API call ─────────────────────────────────────────────────────────────

async function callApi(apiKey, contents) {
  const res = await fetch(
    `${BASE_URL}/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents,
        tools: TOOLS,
        generationConfig: { temperature: 0.4 },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[API] error', res.status, JSON.stringify(err, null, 2))
    throw new Error(err.error?.message ?? `API error ${res.status}`)
  }
  return res.json()
}

// ── Public interface ──────────────────────────────────────────────────────────

export async function sendMessage(apiKey, accessToken, history, userMessage, { onPendingAction, onProgress, onEventsChanged } = {}) {
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await callApi(apiKey, contents)
    const candidate = response.candidates?.[0]
    const parts = candidate?.content?.parts ?? []

    const toolCalls = parts.filter(p => p.functionCall)

    if (toolCalls.length === 0) {
      const reply = parts.map(p => p.text ?? '').join('').trim()
      contents.push({ role: 'model', parts })
      return { reply, history: contents }
    }

    contents.push({ role: 'model', parts })

    const toolResults = []
    for (const part of toolCalls) {
      const { name, args } = part.functionCall

      onProgress?.({ tool: name, args })

      if (WRITE_TOOLS.has(name)) {
        const confirmed = await new Promise(resolve => {
          onPendingAction?.({ name, args, confirm: resolve })
        })
        if (!confirmed) {
          toolResults.push({
            functionResponse: {
              name,
              response: { cancelled: true, message: 'User cancelled this action.' },
            },
          })
          continue
        }
      }

      try {
        const result = await executeTool(name, args, accessToken)
        toolResults.push({
          functionResponse: { name, response: { result } },
        })
        if (WRITE_TOOLS.has(name)) onEventsChanged?.()
      } catch (err) {
        toolResults.push({
          functionResponse: { name, response: { error: err.message } },
        })
      }
    }

    contents.push({ role: 'user', parts: toolResults })
  }
}

export async function getDailyBriefing(apiKey, accessToken) {
  const now = new Date()
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 7)

  const events = await getEvents(accessToken, {
    from: from.toISOString(),
    to: to.toISOString(),
  })

  const nowIso = now.toISOString()
  const briefingPrompt = events.length > 0
    ? `The current time is ${nowIso}. Here are the user's next 7 days of events:\n${JSON.stringify(events, null, 2)}\n\nGive a brief, direct briefing. Prioritize: (1) anything happening right now or within the next 2 hours, (2) high-priority or urgent tasks, (3) events today, then the rest of the week. Flag conflicts, packed days, approaching due dates, or large gaps. Keep it to 3–5 bullet points. If everything looks fine, say so in one sentence.`
    : 'The user has no events in the next 7 days. Let them know their calendar is clear and offer to help them plan the week.'

  return sendMessage(apiKey, accessToken, [], briefingPrompt)
}
