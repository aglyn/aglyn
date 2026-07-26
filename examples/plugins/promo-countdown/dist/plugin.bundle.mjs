/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Promo Countdown — a self-contained community plugin (AGL-882).
 *
 * A live "sale ends in…" countdown banner for tenant sites. It exercises the
 * whole sandbox bundle contract without a build step:
 *
 *   - default render({ mount, props, scheme, emit, hostFetch }) — the tenant
 *     sandbox entry (tools/plugin-loader/load.html). Vanilla DOM only; the
 *     iframe origin has no React. Returns a cleanup fn that stops the timer.
 *   - register(host) — the console/realm entry. Registers a matching preview
 *     widget through the host ABI. Guarded so it's a no-op when the ABI is
 *     absent (e.g. the static verifier just checks the export exists).
 *
 * Self-containment: no static imports, no eval/Function, no browser storage,
 * no cookie access. react/@aglyn come only from the host ABI, so this file
 * IS its own bundle — copy it to dist/plugin.bundle.mjs unchanged.
 */

/** Manifest-declared props, with sensible fallbacks. */
const DEFAULTS = {
  title: 'Limited-time offer',
  targetIso: '', // ISO date the countdown runs to; empty ⇒ shows a hint
  expiredText: "That's a wrap — the offer has ended.",
  accent: '#4f46e5',
  ctaLabel: '', // empty ⇒ no button
  ctaEvent: 'cta',
}

const UNITS = [
  ['days', 86400000],
  ['hours', 3600000],
  ['minutes', 60000],
  ['seconds', 1000],
]

/** Split a positive ms delta into d/h/m/s parts. */
function partsFromMs(ms) {
  let remaining = Math.max(0, ms)
  const out = {}
  for (const [name, size] of UNITS) {
    out[name] = Math.floor(remaining / size)
    remaining -= out[name] * size
  }
  return out
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Theme tokens for the two schemes the bridge sends. */
function palette(scheme) {
  return scheme === 'dark'
    ? { bg: '#111827', fg: '#f9fafb', sub: '#9ca3af', chip: '#1f2937' }
    : { bg: '#ffffff', fg: '#111827', sub: '#6b7280', chip: '#f3f4f6' }
}

/**
 * The tenant sandbox entry. Builds the banner into `mount`, ticks once a
 * second, emits `expired` exactly once when it crosses zero, and wires an
 * optional CTA button to a named event. Returns a cleanup that clears the
 * interval so re-renders (prop/theme changes) never leak timers.
 */
export default function render({ mount, props, scheme, emit }) {
  const config = { ...DEFAULTS, ...(props || {}) }
  const colors = palette(scheme)
  const doc = mount.ownerDocument
  const target = Date.parse(config.targetIso)
  const hasTarget = Number.isFinite(target)

  mount.textContent = ''
  const card = doc.createElement('div')
  card.setAttribute('data-testid', 'promo-countdown')
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
    'font-size:13px;font-weight:600;letter-spacing:.02em;color:' + config.accent
  card.appendChild(heading)

  const body = doc.createElement('div')
  body.style.cssText = 'margin-top:10px;font-size:15px;color:' + colors.fg
  card.appendChild(body)

  let button = null
  if (config.ctaLabel) {
    button = doc.createElement('button')
    button.type = 'button'
    button.textContent = config.ctaLabel
    button.style.cssText = [
      'margin-top:12px',
      'appearance:none',
      'border:0',
      'cursor:pointer',
      'padding:8px 14px',
      'border-radius:8px',
      'font-size:13px',
      'font-weight:600',
      'color:#fff',
      'background:' + config.accent,
    ].join(';')
    button.addEventListener('click', () =>
      emit(config.ctaEvent || 'cta', { title: config.title }),
    )
    card.appendChild(button)
  }

  mount.appendChild(card)

  function renderTiles(parts) {
    body.textContent = ''
    const row = doc.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap'
    for (const [name] of UNITS) {
      const chip = doc.createElement('div')
      chip.style.cssText = [
        'min-width:56px',
        'text-align:center',
        'padding:8px 6px',
        'border-radius:8px',
        'background:' + colors.chip,
      ].join(';')
      const num = doc.createElement('div')
      num.style.cssText = 'font-size:20px;font-weight:700;font-variant-numeric:tabular-nums'
      num.textContent = name === 'days' ? String(parts[name]) : pad(parts[name])
      const label = doc.createElement('div')
      label.style.cssText = 'margin-top:2px;font-size:10px;text-transform:uppercase;color:' + colors.sub
      label.textContent = name
      chip.appendChild(num)
      chip.appendChild(label)
      row.appendChild(chip)
    }
    body.appendChild(row)
  }

  let done = false
  function tick() {
    if (!hasTarget) {
      body.textContent = 'Set a target date to start the countdown.'
      body.style.color = colors.sub
      return
    }
    const delta = target - Date.now()
    if (delta <= 0) {
      if (!done) {
        done = true
        emit('expired', { title: config.title })
      }
      body.textContent = config.expiredText
      body.style.color = colors.sub
      if (button) button.disabled = true
      return
    }
    renderTiles(partsFromMs(delta))
  }

  tick()
  const timer = hasTarget && !done ? setInterval(tick, 1000) : null
  return () => {
    if (timer) clearInterval(timer)
  }
}

/**
 * Console/realm entry (also satisfies the verifier's export contract). Adds a
 * small "Promo Countdown" activity widget so staff/admins can see the plugin
 * is live. Uses only the host ABI, and no-ops if it isn't present.
 */
export function register(host) {
  const h = host || globalThis.__AGLYN_PLUGIN_HOST__
  if (!h || !h.aglyn || !h.React) return
  const React = h.React
  h.aglyn.registerConsoleExtension({
    pluginId: 'promo-countdown',
    displayName: 'Promo Countdown',
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'promo-countdown-status',
        title: 'Promo Countdown',
        Component: () =>
          React.createElement(
            'div',
            { style: { padding: 8, fontSize: 13 } },
            'Drop the Promo Countdown element on a page to run a live sale timer.',
          ),
      },
    ],
  })
}
