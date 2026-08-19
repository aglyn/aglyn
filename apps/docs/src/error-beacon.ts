/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * First-party browser error beacon for docs.aglyn.com (AGL-1646).
 *
 * The getting-started guides ARE the activation path (AGL-1579 established
 * this: there is no in-product onboarding), so a JS error here is an
 * activation failure — and until now it was unobserved.
 *
 * This is a deliberate STANDALONE copy of the wire behaviour of
 * `libs/aglyn/src/lib/app-utils/error-beacon.ts` (AGL-1538). This app cannot
 * import `libs/` — standalone node_modules, React 18, and the Vercel project
 * builds with `sourceFilesOutsideRootDirectory: false` (AGL-1595) — so the
 * shared module is out of reach by construction. What must stay identical is
 * the WIRE FORMAT: `POST { events: [{ kind, message, stack?, source?, line?,
 * col?, url }] }`, because reports land in the console's existing collector
 * (`apps/console/app/api/errors/route.ts`), which clamps them again and
 * forwards to Cloud Error Reporting — under service `docs-web`, keyed on the
 * request `Origin` header. If the lib's payload shape changes, change this
 * copy too.
 *
 * Loaded as a Docusaurus client module (`clientModules` in
 * docusaurus.config.ts) — framework-free, installs window-level handlers
 * once per page load; Docusaurus SPA route changes reuse them.
 *
 * Consent/PII posture matches the docs analytics decision (AGL-1579): docs
 * is a first-party surface, and this is strictly-necessary operational
 * telemetry with NO PII — URLs are scrubbed to origin + pathname (so
 * `/search?q=…` loses its query), no user identifier, no cookies. The
 * payload is the error text and where in the CODE it happened.
 *
 * Cross-origin on purpose: docs is static and has no same-origin API. Both
 * transports are CORS *simple requests* — `sendBeacon` with a string body
 * posts `text/plain`, and the `fetch` fallback deliberately sets no
 * `Content-Type` header — so delivery needs no preflight; the collector
 * parses raw text regardless of content type and also answers OPTIONS for
 * clients that preflight anyway.
 *
 * Armed only in production builds, mirroring the gtag posture in
 * docusaurus.config.ts: `docusaurus start` never reports, and this Vercel
 * project has no preview deployments to leak from.
 *
 * Design constraints inherited from the lib beacon, in order:
 * - It must never become the outage: everything is wrapped, a failure to
 *   report is silence, and after `MAX_PER_PAGE` events the beacon disarms
 *   for the rest of the pageview.
 * - Dedupe: one page throwing the same error on every frame reports it once.
 * - Cross-origin scripts surface as the opaque "Script error." with no
 *   stack; those are dropped since they cannot be acted on.
 */

import siteConfig from '@generated/docusaurus.config'

/**
 * Where reports go — CONFIGURATION, and absent by default (AGL-2124).
 *
 * This was a bare production-console URL. `apps/docs` ships in the
 * open-source distribution, so an operator's page URLs, stack traces and user
 * agents were POSTed to Aglyn's console, where the collector files them under
 * service `docs-web` keyed on the `Origin` header — as if they were ours.
 * Neither party consented and neither benefits: they get no error reporting,
 * our Error Reporting fills with stacks from somebody else's deployment.
 *
 * Unset means OFF, never ours. `@generated/docusaurus.config` is the one
 * channel from build config to a client module — `useDocusaurusContext` is a
 * hook and this file is not a component.
 */
const ENDPOINT = ((): string => {
  try {
    const configured = (siteConfig?.customFields as Record<string, unknown>)?.[
      'errorBeaconEndpoint'
    ]
    return typeof configured === 'string' ? configured.trim() : ''
  } catch {
    return ''
  }
})()
const MAX_MESSAGE = 1_024
const MAX_STACK = 8_192
const MAX_PER_PAGE = 10
const FLUSH_DELAY_MS = 2_000

interface ErrorBeaconEvent {
  kind: string
  message: string
  stack?: string
  source?: string
  line?: number
  col?: number
  url: string
}

/** Origin + pathname only — query strings and fragments never leave. */
function scrubUrl(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const url = new URL(String(raw), window.location.href)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

function clamp(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max)
}

function installErrorBeacon(): void {
  const seen = new Set<string>()
  let queued: ErrorBeaconEvent[] = []
  let sent = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (!queued.length) return
    const batch = queued
    queued = []
    try {
      const body = JSON.stringify({ events: batch })
      // sendBeacon survives unloads and never blocks; keepalive fetch is the
      // fallback for browsers that refuse the payload. Neither sets a JSON
      // content type: text/plain keeps the cross-origin POST a simple
      // request, and the collector parses the raw body either way.
      if (!navigator.sendBeacon?.(ENDPOINT, body)) {
        void fetch(ENDPOINT, {
          method: 'POST',
          body,
          keepalive: true,
        }).catch((): undefined => undefined)
      }
    } catch {
      // Reporting never breaks the page.
    }
  }

  const enqueue = (event: ErrorBeaconEvent) => {
    if (sent >= MAX_PER_PAGE) return
    // Message + first stack line: enough identity to collapse a render loop
    // without collapsing distinct errors that share a message.
    const key = `${event.message}\x00${(event.stack ?? '').split('\n', 2).join('\n')}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    queued.push(event)
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS)
  }

  window.addEventListener('error', (event) => {
    try {
      const error = event.error as Error | undefined
      const message = clamp(error?.message ?? event.message, MAX_MESSAGE)
      // Cross-origin scripts yield an opaque "Script error." with nothing
      // actionable attached; reporting it would only create a noisy group.
      if (!message || message === 'Script error.') return
      enqueue({
        kind: 'error',
        message,
        stack: error?.stack ? clamp(error.stack, MAX_STACK) : undefined,
        source: scrubUrl(event.filename) || undefined,
        line: typeof event.lineno === 'number' ? event.lineno : undefined,
        col: typeof event.colno === 'number' ? event.colno : undefined,
        url: scrubUrl(window.location.href),
      })
    } catch {
      // Never rethrow from an error handler.
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason as Error | undefined
      const message = clamp(
        reason?.message ??
          (typeof event.reason === 'string'
            ? event.reason
            : 'Unhandled promise rejection'),
        MAX_MESSAGE,
      )
      if (!message) return
      enqueue({
        kind: 'unhandledrejection',
        message,
        stack: reason?.stack ? clamp(reason.stack, MAX_STACK) : undefined,
        url: scrubUrl(window.location.href),
      })
    } catch {
      // Never rethrow from an error handler.
    }
  })

  // A batch waiting out its debounce when the page hides would be lost;
  // `pagehide`/`visibilitychange` are the last reliable moments to send.
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

// Client modules can still be evaluated during the static build; the beacon
// is browser-only, and dev servers stay disarmed (mirrors the gtag gate).
//
// A THIRD arming gate (AGL-2124): with no configured endpoint the beacon
// installs NO handlers at all. Not a fallback to ours — an unconfigured
// self-host build reports nowhere, which is the only honest default when the
// alternative is reporting a stranger's errors to us.
if (
  typeof window !== 'undefined' &&
  process.env.NODE_ENV === 'production' &&
  ENDPOINT
) {
  installErrorBeacon()
}
