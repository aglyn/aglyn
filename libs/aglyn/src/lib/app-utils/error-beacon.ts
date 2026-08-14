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
 * First-party browser error beacon (AGL-1538).
 *
 * Crashlytics does not exist for web, and adding a third-party error vendor
 * is a subprocessor-list decision that was explicitly deferred. This is the
 * first-party alternative: `window.onerror` / `unhandledrejection` handlers
 * that batch uncaught failures to the app's own `/api/errors` route, which
 * forwards them to Google Cloud Error Reporting — a processor already on the
 * list, alerting through the GCP stack that already pages (AGL-1502).
 *
 * Design constraints, in order:
 *
 * - **It must never become the outage.** Everything is wrapped; a failure to
 *   report is silence, not a thrown error. Batches are capped per page so an
 *   error thrown in a loop cannot DDoS our own API — after `maxPerPage`
 *   events the beacon disarms for the rest of the pageview.
 * - **No PII.** URLs are scrubbed to origin + pathname (query strings and
 *   fragments carry tokens and search terms), no user id, no cookies —
 *   the payload is the error text and where in the CODE it happened.
 *   Cross-origin scripts surface as the browser's opaque "Script error."
 *   with no stack; those are dropped since they cannot be acted on.
 * - **Dedupe.** One page throwing the same error on every frame reports it
 *   once.
 *
 * Framework-free on purpose: the console mounts it from its root layout, the
 * tenant runtime from its own, and neither needs React here. Deliberately NO
 * 'use client' directive — inside this shared lib the directive forks the
 * module graph (AGL-52); every importer is already a client module.
 */

export interface ErrorBeaconEvent {
  /** 'error' | 'unhandledrejection' — which handler caught it. */
  kind: string
  /** Error message, clamped. */
  message: string
  /** Stack trace when the thrown value carried one, clamped. */
  stack?: string
  /** Script URL for stackless `window.onerror` events, scrubbed. */
  source?: string
  line?: number
  col?: number
  /** Page URL, scrubbed to origin + pathname. */
  url: string
}

export interface ErrorBeaconOptions {
  /** POST target; same-origin. Default `/api/errors`. */
  endpoint?: string
  /** 0..1 — fraction of pageviews that report at all. Default 1. */
  sampleRate?: number
  /** Max events reported per pageview before the beacon disarms. */
  maxPerPage?: number
}

const MAX_MESSAGE = 1_024
const MAX_STACK = 8_192
const FLUSH_DELAY_MS = 2_000

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

let installed = false

/**
 * Installs the handlers once per page. Safe to call from module scope of a
 * client bundle: it no-ops during SSR and on repeat calls.
 */
export function installErrorBeacon(options?: ErrorBeaconOptions): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  const endpoint = options?.endpoint ?? '/api/errors'
  const sampleRate = options?.sampleRate ?? 1
  const maxPerPage = options?.maxPerPage ?? 10
  if (Math.random() >= sampleRate) return

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
      // fallback for browsers that refuse the payload.
      if (!navigator.sendBeacon?.(endpoint, body)) {
        void fetch(endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
        }).catch((): undefined => undefined)
      }
    } catch {
      // Reporting never breaks the page.
    }
  }

  const enqueue = (event: ErrorBeaconEvent) => {
    if (sent >= maxPerPage) return
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
        reason?.message ?? (typeof event.reason === 'string' ? event.reason : 'Unhandled promise rejection'),
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
