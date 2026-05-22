import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/GoogleAuth.jsx'
import { sendMessage, getDailyBriefing } from '../lib/AssistantHandler.js'
import { getEvent } from '../lib/CalendarHandler.js'
import './MessageView.css'

const PROGRESS_LABELS = {
  get_events:          'Checking your calendar…',
  get_events_for_day:  'Checking your calendar…',
  find_free_slots:     'Finding free slots…',
  find_conflicts:      'Checking for conflicts…',
  search_events:       'Searching your events…',
  create_event:        'Creating event…',
  modify_event:        'Updating event…',
  reschedule_event:    'Rescheduling event…',
  delete_event:        'Deleting event…',
}

function formatTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

const PRIORITY_LABELS = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Very low' }
const SCOPE_LABELS    = { this: 'This occurrence only', following: 'This and all future occurrences', all: 'Entire series' }

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ActionCard({ name, args, eventDetails, onConfirm, onCancel }) {
  const resolvedTitle = args.title ?? eventDetails?.title ?? 'event'

  const labels = {
    create_event:     `Create "${args.title}"`,
    modify_event:     `Update "${resolvedTitle}"`,
    reschedule_event: `Reschedule "${resolvedTitle}"`,
    delete_event:     `Delete "${resolvedTitle}"`,
  }

  let timeInfo = null
  if (name === 'reschedule_event') {
    const currentStart = eventDetails?.start
    const newStart = args.newStart
    if (currentStart && newStart) {
      timeInfo = `${formatTime(currentStart)} → ${formatTime(newStart)}`
    } else if (newStart) {
      timeInfo = `Moving to: ${formatTime(newStart)}`
    }
  } else if (name === 'delete_event' && eventDetails?.start) {
    timeInfo = eventDetails.end
      ? `${formatTime(eventDetails.start)} → ${formatTime(eventDetails.end)}`
      : formatTime(eventDetails.start)
  } else {
    const start = args.start ?? args.newStart
    if (start) {
      timeInfo = args.end
        ? `${formatTime(start)} → ${formatTime(args.end)}`
        : formatTime(start)
    }
  }

  const meta = eventDetails?.metadata ?? {}
  const details = [
    args.description
      ? { label: 'Description', value: args.description }
      : (name === 'delete_event' || name === 'reschedule_event') && eventDetails?.description
        ? { label: 'Description', value: eventDetails.description }
        : null,
    args.priority !== undefined
      ? { label: 'Priority', value: PRIORITY_LABELS[args.priority] ?? args.priority }
      : meta.priority !== undefined
        ? { label: 'Priority', value: PRIORITY_LABELS[meta.priority] ?? meta.priority }
        : null,
    args.dueDate
      ? { label: 'Due', value: formatDate(args.dueDate) }
      : meta.dueDate
        ? { label: 'Due', value: formatDate(meta.dueDate) }
        : null,
    args.flexibility !== undefined
      ? { label: 'Flexibility', value: args.flexibility === 0 ? 'Fixed' : 'Flexible' }
      : meta.flexibility !== undefined
        ? { label: 'Flexibility', value: meta.flexibility === 0 ? 'Fixed' : 'Flexible' }
        : null,
    args.progress && { label: 'Progress', value: args.progress },
    args.scope && { label: 'Scope', value: SCOPE_LABELS[args.scope] ?? args.scope },
  ].filter(Boolean)

  return (
    <div className="action-card">
      <p className="action-card__label">{labels[name]}</p>
      {timeInfo && <p className="action-card__time">{timeInfo}</p>}
      {details.length > 0 && (
        <dl className="action-card__details">
          {details.map(({ label, value }) => (
            <div key={label} className="action-card__detail-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="action-card__buttons">
        <button className="action-card__confirm" onClick={onConfirm}>Confirm</button>
        <button className="action-card__cancel"  onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Message({ role, text }) {
  return (
    <div className={`message message--${role}`}>
      <p className="message__text">{text}</p>
    </div>
  )
}

function ProgressIndicator({ text }) {
  return (
    <div className="progress-indicator">
      <span className="progress-indicator__dot" />
      <span className="progress-indicator__dot" />
      <span className="progress-indicator__dot" />
      <span className="progress-indicator__label">{text}</span>
    </div>
  )
}

export default function MessageView({ apiKey, onEventsChanged, onPendingEvent }) {
  const { accessToken } = useAuth()
  const [messages,           setMessages]           = useState([])
  const [history,            setHistory]            = useState([])
  const [input,              setInput]              = useState('')
  const [isLoading,          setIsLoading]          = useState(false)
  const [progressText,       setProgressText]       = useState(null)
  const [pendingAction,      setPendingAction]      = useState(null)
  const [pendingEventDetails, setPendingEventDetails] = useState(null)
  const bottomRef  = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function loadBriefing() {
      setIsLoading(true)
      setProgressText('Loading your week…')
      try {
        const { reply, history: h } = await getDailyBriefing(apiKey, accessToken)
        if (cancelled) return
        setMessages([{ role: 'assistant', text: reply }])
        setHistory(h)
      } catch (err) {
        if (cancelled) return
        console.error('[Briefing error]', err)
        setMessages([{ role: 'assistant', text: `Error: ${err.message}` }])
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setProgressText(null)
        }
      }
    }
    loadBriefing()
    return () => { cancelled = true }
  }, [accessToken])

  useEffect(() => {
    const eventId = pendingAction?.args?.eventId ?? null
    onPendingEvent?.(eventId)
    if (!eventId || !accessToken) { setPendingEventDetails(null); return }
    getEvent(accessToken, eventId)
      .then(setPendingEventDetails)
      .catch(() => setPendingEventDetails(null))
  }, [pendingAction, accessToken, onPendingEvent])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, progressText, pendingAction])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setIsLoading(true)

    try {
      const { reply, history: newHistory } = await sendMessage(
        apiKey,
        accessToken,
        history,
        text,
        {
          onProgress: ({ tool }) => setProgressText(PROGRESS_LABELS[tool] ?? 'Working…'),
          onPendingAction: ({ name, args, confirm }) => {
            setProgressText(null)
            setPendingAction({ name, args, confirm })
          },
          onEventsChanged,
        }
      )
      setHistory(newHistory)
      setMessages(prev => [...prev, { role: 'assistant', text: reply }])
    } catch (err) {
      console.error('[sendMessage error]', err)
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `Error: ${err.message}`,
      }])
    } finally {
      setIsLoading(false)
      setProgressText(null)
      setPendingAction(null)
    }
  }, [input, isLoading, apiKey, accessToken, history, onEventsChanged])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  const handleInput = (e) => {
    setInput(e.target.value)
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
  }

  return (
    <div className="command-bar">
      <div className="command-bar__messages">
        {messages.map((msg, i) => (
          <Message key={i} role={msg.role} text={msg.text} />
        ))}

        {pendingAction && (
          <ActionCard
            name={pendingAction.name}
            args={pendingAction.args}
            eventDetails={pendingEventDetails}
            onConfirm={() => { pendingAction.confirm(true);  setPendingAction(null) }}
            onCancel={() =>  { pendingAction.confirm(false); setPendingAction(null) }}
          />
        )}

        {!pendingAction && progressText && (
          <ProgressIndicator text={progressText} />
        )}

        <div ref={bottomRef} />
      </div>

      <div className="command-bar__input-row">
        <textarea
          ref={textareaRef}
          className="command-bar__textarea"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your schedule…"
          disabled={isLoading}
          rows={1}
        />
        <button
          className="command-bar__send"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
