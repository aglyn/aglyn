/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zen Quote — the worked example of a plugin that DECLARES a network origin
 * (AGL-1092).
 *
 * It fetches one line of text from `https://api.github.com/zen` and shows it.
 * That is the whole feature, and it exists because every other example
 * declares no network at all, so nothing in this repo demonstrated the half
 * of the sandbox contract where a plugin is *allowed* to reach an origin:
 *
 *   - `capabilities.network: ["https://api.github.com"]` in the manifest
 *     becomes this plugin's `connect-src` on the plugin origin, so this fetch
 *     succeeds and a fetch to anything else is refused by the browser.
 *   - The publish-time verifier reads the same list: an origin called but not
 *     declared fails the publish (AGL-964). It resolves the URL through the
 *     constant below (AGL-1093), so writing the request the idiomatic way
 *     still earns a checked pass rather than a "could not follow it" question.
 *
 * Data handling: it sends nothing. No props, page content, member data or
 * identifiers leave the frame; the request has no body, no credentials and no
 * query string. The response is a short public aphorism, rendered as TEXT
 * (never as HTML), so a hostile response cannot inject markup.
 *
 * Self-containment: no static imports, no eval/Function, no browser storage,
 * no cookie access — this file IS its own bundle, copied to
 * dist/plugin.bundle.mjs unchanged.
 */

const ENDPOINT = 'https://api.github.com/zen'

const DEFAULTS = {
  title: 'Thought for the day',
  accent: '#4f46e5',
}

/**
 * Tenant sandbox entry. Vanilla DOM only — the iframe origin has no React.
 * Returns a cleanup function that abandons an in-flight request, so a props
 * change or unmount cannot write into a mount the host has moved on from.
 */
export default function render({ mount, props, scheme, emit }) {
  const settings = { ...DEFAULTS, ...(props || {}) }
  const dark = scheme === 'dark'
  let live = true

  mount.textContent = ''
  const root = document.createElement('div')
  root.style.cssText = [
    'font-family: system-ui, -apple-system, sans-serif',
    'display: flex',
    'flex-direction: column',
    'gap: 6px',
    'padding: 12px 14px',
    'border-radius: 10px',
    `border: 1px solid ${dark ? '#333' : '#e5e5e5'}`,
    `color: ${dark ? '#f5f5f5' : '#111'}`,
  ].join(';')

  const heading = document.createElement('div')
  heading.textContent = String(settings.title)
  heading.style.cssText = `font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: ${String(
    settings.accent,
  )}`

  const quote = document.createElement('p')
  quote.textContent = 'Loading…'
  quote.style.cssText = 'margin: 0; font-size: 16px; line-height: 1.4'

  root.appendChild(heading)
  root.appendChild(quote)
  mount.appendChild(root)

  // The declared origin. Blocked by this plugin's own CSP if the manifest
  // ever stops declaring it — which is the point of the example.
  fetch(ENDPOINT, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    .then((text) => {
      if (!live) return
      // textContent, never innerHTML: the response is somebody else's bytes.
      quote.textContent = text.trim() || '(empty response)'
      if (typeof emit === 'function') emit('loaded', { length: text.length })
    })
    .catch((error) => {
      if (!live) return
      quote.textContent = `Could not reach ${ENDPOINT} — ${error.message}`
      quote.style.color = dark ? '#f8a' : '#b00'
      if (typeof emit === 'function') emit('failed', { message: error.message })
    })

  return () => {
    live = false
  }
}

/**
 * Console/realm entry, and the export the verifier requires. Host ABI only,
 * and a no-op when the ABI is absent.
 */
export function register(host) {
  const h = host || globalThis.__AGLYN_PLUGIN_HOST__
  if (!h || !h.aglyn || !h.React) return
  const React = h.React
  h.aglyn.registerConsoleExtension({
    pluginId: 'zen-quote',
    displayName: 'Zen Quote',
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'zen-quote-status',
        title: 'Zen Quote',
        Component: () =>
          React.createElement(
            'div',
            { style: { padding: 8, fontSize: 13 } },
            'Drop the Zen Quote element on a page to show a line from api.github.com.',
          ),
      },
    ],
  })
}
