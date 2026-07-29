/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Office Hours — a self-contained community plugin (AGL-969).
 *
 * Shows whether you are open right now, and when you next open or close,
 * from a weekly schedule passed as props. Written to be the SECOND worked
 * example beside promo-countdown, and published through the real pipeline to
 * exercise the publisher attestation end to end.
 *
 * Same bundle contract, no build step:
 *
 *   - default render({ mount, props, scheme, emit }) — the tenant sandbox
 *     entry. Vanilla DOM only; the iframe origin has no React. Returns a
 *     cleanup fn that stops the minute timer.
 *   - register(host) — the console/realm entry, via the host ABI, a no-op
 *     when the ABI is absent.
 *
 * Self-containment: no static imports, no eval/Function, no browser storage,
 * no cookie access, and no declared network hosts — the schedule arrives as
 * props, so this plugin never needs to reach anything.
 */

const DEFAULTS = {
  title: 'Office hours',
  // "HH:MM-HH:MM" per day, empty string = closed. Sunday first, to match
  // Date#getDay so an off-by-one cannot creep in between the two.
  sunday: '',
  monday: '09:00-17:00',
  tuesday: '09:00-17:00',
  wednesday: '09:00-17:00',
  thursday: '09:00-17:00',
  friday: '09:00-17:00',
  saturday: '',
  openLabel: 'Open now',
  closedLabel: 'Closed',
  accent: '#16a34a',
}

const DAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

/** Minutes since midnight for "HH:MM", or null if it isn't one. */
function minutesFromClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * One day's ranges. A range whose end is at or before its start is dropped
 * rather than silently wrapping past midnight — an overnight window is a
 * real case, but guessing at it would make "22:00-06:00" mean something the
 * publisher did not write.
 */
function rangesForDay(value) {
  const out = []
  for (const part of String(value ?? '').split(',')) {
    const halves = part.split('-')
    if (halves.length !== 2) continue
    const from = minutesFromClock(halves[0])
    const to = minutesFromClock(halves[1])
    if (from == null || to == null || to <= from) continue
    out.push({ from, to })
  }
  return out
}

function clockFromMinutes(total) {
  const hours = Math.floor(total / 60) % 24
  const minutes = total % 60
  const suffix = hours < 12 ? 'am' : 'pm'
  const display = hours % 12 === 0 ? 12 : hours % 12
  return minutes
    ? `${display}:${String(minutes).padStart(2, '0')}${suffix}`
    : `${display}${suffix}`
}

/**
 * Open/closed plus the next boundary, searching forward up to a week. The
 * week bound is what makes an all-closed schedule terminate instead of
 * looping — it reports "no upcoming hours" rather than spinning.
 */
function statusAt(config, now) {
  const day = now.getDay()
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  const today = rangesForDay(config[DAYS[day]])
  const current = today.find(
    (range) => minuteOfDay >= range.from && minuteOfDay < range.to,
  )
  if (current) {
    return { open: true, until: clockFromMinutes(current.to), nextDay: null }
  }
  const laterToday = today.find((range) => range.from > minuteOfDay)
  if (laterToday) {
    return {
      open: false,
      until: clockFromMinutes(laterToday.from),
      nextDay: null,
    }
  }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const name = DAYS[(day + ahead) % 7]
    const ranges = rangesForDay(config[name])
    if (ranges.length) {
      return {
        open: false,
        until: clockFromMinutes(ranges[0].from),
        nextDay: name,
      }
    }
  }
  return { open: false, until: null, nextDay: null }
}

function palette(scheme) {
  return scheme === 'dark'
    ? { bg: '#111827', fg: '#f9fafb', sub: '#9ca3af', chip: '#1f2937' }
    : { bg: '#ffffff', fg: '#111827', sub: '#6b7280', chip: '#f3f4f6' }
}

function titleCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export default function render({ mount, props, scheme, emit }) {
  const config = { ...DEFAULTS, ...(props || {}) }
  const colors = palette(scheme)
  const doc = mount.ownerDocument

  mount.textContent = ''
  const card = doc.createElement('div')
  card.setAttribute('data-testid', 'office-hours')
  card.style.cssText = [
    'box-sizing:border-box',
    'width:100%',
    'padding:16px 20px',
    'border-radius:12px',
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'border:1px solid ' + colors.chip,
    'background:' + colors.bg,
    'color:' + colors.fg,
  ].join(';')

  const heading = doc.createElement('div')
  heading.textContent = config.title
  heading.style.cssText =
    'font-size:13px;font-weight:600;letter-spacing:.02em;color:' + colors.sub
  card.appendChild(heading)

  const statusRow = doc.createElement('div')
  statusRow.style.cssText =
    'margin-top:10px;display:flex;align-items:center;gap:8px'
  const dot = doc.createElement('span')
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none'
  const label = doc.createElement('span')
  label.style.cssText = 'font-size:17px;font-weight:700'
  statusRow.appendChild(dot)
  statusRow.appendChild(label)
  card.appendChild(statusRow)

  const detail = doc.createElement('div')
  detail.style.cssText = 'margin-top:6px;font-size:13px;color:' + colors.sub
  card.appendChild(detail)

  const week = doc.createElement('div')
  week.style.cssText = 'margin-top:12px;display:grid;gap:2px;font-size:12px'
  card.appendChild(week)

  mount.appendChild(card)

  for (const name of DAYS) {
    const ranges = rangesForDay(config[name])
    const row = doc.createElement('div')
    row.style.cssText =
      'display:flex;justify-content:space-between;gap:16px;color:' + colors.sub
    const left = doc.createElement('span')
    left.textContent = titleCase(name)
    const right = doc.createElement('span')
    right.textContent = ranges.length
      ? ranges
          .map(
            (range) =>
              `${clockFromMinutes(range.from)}–${clockFromMinutes(range.to)}`,
          )
          .join(', ')
      : config.closedLabel
    row.appendChild(left)
    row.appendChild(right)
    week.appendChild(row)
  }

  // Only announce a CHANGE, not every tick — a host listening for "opened"
  // should hear it once, not sixty times an hour.
  let announced = null
  function paint() {
    const status = statusAt(config, new Date())
    dot.style.background = status.open ? config.accent : colors.sub
    label.textContent = status.open ? config.openLabel : config.closedLabel
    if (status.open) {
      detail.textContent = status.until ? `Until ${status.until}` : ''
    } else if (status.until) {
      detail.textContent = status.nextDay
        ? `Opens ${titleCase(status.nextDay)} at ${status.until}`
        : `Opens at ${status.until}`
    } else {
      detail.textContent = 'No upcoming hours set.'
    }
    if (announced !== status.open) {
      const first = announced === null
      announced = status.open
      if (!first) emit(status.open ? 'opened' : 'closed', { title: config.title })
    }
  }

  paint()
  const timer = setInterval(paint, 60000)
  return () => clearInterval(timer)
}

/**
 * Console/realm entry (and the export the static verifier looks for). Adds a
 * small activity widget so an admin can see the plugin is live. Host ABI
 * only, and a no-op when it is absent.
 */
export function register(host) {
  const h = host || globalThis.__AGLYN_PLUGIN_HOST__
  if (!h || !h.aglyn || !h.React) return
  const React = h.React
  h.aglyn.registerConsoleExtension({
    pluginId: 'office-hours',
    displayName: 'Office Hours',
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'office-hours-status',
        title: 'Office Hours',
        Component: () =>
          React.createElement(
            'div',
            { style: { padding: 8, fontSize: 13 } },
            'Office hours are published from this plugin’s props.',
          ),
      },
    ],
  })
}
