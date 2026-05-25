import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../lib/GoogleAuth.jsx'
import { getEvents } from '../lib/CalendarHandler.js'
import './CalendarView.css'

const HOUR_HEIGHT = 64
const DAY_START   = 0
const DAY_END     = 24

function startOfWeek(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatHour(h) {
  if (h === 0)  return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function eventPosition(event) {
  const start = new Date(event.start)
  const end   = new Date(event.end)
  // all-day events have no start hour to position against the time grid
  if (!event.start.includes('T')) return null

  const startH = start.getHours() + start.getMinutes() / 60
  const endH   = end.getHours()   + end.getMinutes()   / 60
  const top    = (Math.max(startH, DAY_START) - DAY_START) * HOUR_HEIGHT
  const height = Math.max((Math.min(endH, DAY_END) - Math.max(startH, DAY_START)) * HOUR_HEIGHT, 20)
  if (height <= 0) return null
  return { top, height }
}

function nowLineY() {
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60
  if (h < DAY_START || h > DAY_END) return null
  return (h - DAY_START) * HOUR_HEIGHT
}

const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

export default function CalendarView({ refreshCount, highlightEventId, focusDate }) {
  const { accessToken } = useAuth()
  const [weekStart, setWeekStart] = useState(startOfWeek)
  const [events,    setEvents]    = useState([])

  useEffect(() => {
    if (!focusDate) return
    setWeekStart(startOfWeek(focusDate))
  }, [focusDate])
  const bodyRef = useRef(null)
  const nowRef  = useRef(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!accessToken) return
    getEvents(accessToken, {
      from: weekStart.toISOString(),
      to:   addDays(weekStart, 7).toISOString(),
    }).then(setEvents).catch(console.error)
  }, [accessToken, weekStart, refreshCount])

  useEffect(() => {
    if (!bodyRef.current) return
    const noon = 12 * HOUR_HEIGHT
    bodyRef.current.scrollTop = noon - bodyRef.current.clientHeight / 2
  }, [])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const weekLabel = (() => {
    const end = addDays(weekStart, 6)
    if (weekStart.getMonth() === end.getMonth())
      return weekStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  })()

  function eventsForDay(day) {
    const lo = new Date(day); lo.setHours(0, 0, 0, 0)
    const hi = new Date(day); hi.setHours(23, 59, 59, 999)
    return events.filter(e => {
      const s = new Date(e.start)
      return s >= lo && s <= hi
    })
  }

  const nowY = nowLineY()

  return (
    <div className="cal">
      <div className="cal__nav">
        <button onClick={() => setWeekStart(d => addDays(d, -7))}>‹</button>
        <span className="cal__nav-label">{weekLabel}</span>
        <button onClick={() => setWeekStart(startOfWeek())}>Today</button>
        <button onClick={() => setWeekStart(d => addDays(d, 7))}>›</button>
      </div>

      <div className="cal__head">
        <div className="cal__gutter" />
        {days.map(day => {
          const isToday = day.getTime() === today.getTime()
          return (
            <div key={day} className={`cal__day-head${isToday ? ' cal__day-head--today' : ''}`}>
              <span className="cal__day-name">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span className={`cal__day-num${isToday ? ' cal__day-num--today' : ''}`}>
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      <div className="cal__body" ref={bodyRef}>
        <div className="cal__gutter">
          {HOURS.map(h => (
            <div key={h} className="cal__hour-label" style={{ height: HOUR_HEIGHT }}>
              {formatHour(h)}
            </div>
          ))}
        </div>

        {days.map(day => {
          const isToday = day.getTime() === today.getTime()
          return (
            <div key={day} className="cal__col">
              {HOURS.map(h => (
                <div key={h} className="cal__cell" style={{ height: HOUR_HEIGHT }} />
              ))}

              {isToday && nowY !== null && (
                <div className="cal__now" style={{ top: nowY }} ref={nowRef} />
              )}

              {eventsForDay(day).map(event => {
                const pos = eventPosition(event)
                if (!pos) return null
                const isHighlighted = event.id === highlightEventId
                return (
                  <div
                    key={event.id}
                    className={`cal__event${isHighlighted ? ' cal__event--highlight' : ''}`}
                    style={{ top: pos.top, height: pos.height }}
                    title={event.title}
                  >
                    <span className="cal__event-title">{event.title}</span>
                    {pos.height >= 40 && (
                      <span className="cal__event-time">
                        {new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
