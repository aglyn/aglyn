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

/**
 * Every URL a stack frame points at, whichever engine produced the stack.
 *
 * One pattern covers both formats because the frame's URL is always followed
 * by `:line:col`: V8 writes `at fn (URL:1:2)` and `at URL:1:2`, WebKit and
 * Firefox write `fn@URL:1:2` and `@URL:1:2`. Matching on the suffix rather
 * than on the prefix means neither engine needs its own branch, and a format
 * this code has never seen degrades to "no frames parsed" rather than to a
 * wrong answer.
 */
function stackFrameUrls(stack: string): string[] {
  const urls: string[] = []
  const frame = /((?:https?|file|blob):\/\/[^\s()]+?):\d+:\d+/g
  let match: RegExpExecArray | null
  while ((match = frame.exec(stack)) !== null) urls.push(match[1])
  return urls
}

/**
 * Was this thrown by a script somebody ELSE evaluated into our page?
 *
 * Measured 2026-09-02 (AGL-2523) on aglyn.com/pricing, reported as an error
 * of ours:
 *
 *     sendDataToNative@https://aglyn.com/pricing:1:1325
 *     sendPageHideMessage@https://aglyn.com/pricing:1:4139
 *     @https://aglyn.com/pricing:1:6257
 *
 * `sendDataToNative` is the Meta in-app browser's native bridge, injected by
 * the Facebook/Instagram webview. The tell is not the function name — that
 * would be a denylist needing a new entry per vendor — but the URLs: every
 * frame is the DOCUMENT, so the code was evaluated inline in the page rather
 * than loaded from a script we served. Nothing we ship can be fixed in
 * response to it, which is the same test the opaque `Script error.` cut
 * already applies.
 *
 * ⚑ Deliberately `every`, and deliberately compared against the document
 * rather than against our asset path. A rule like "no frame under
 * `/_next/static/`" would delete EVERY error from a self-hosted deployment
 * that serves its assets from a CDN, because none of its frames would match.
 * Comparing to the document cannot fail that way: a CDN frame is not the
 * document either, so it keeps the report.
 *
 * The cost is honest and small: a throw from one of our own inline
 * bootstrap scripts looks the same and is dropped with it. That trade buys a
 * rule that needs no maintenance as new webviews and extensions appear.
 */
export function isInjectedThirdPartyFrame(
  stack: string,
  documentUrl: string,
): boolean {
  const urls = stackFrameUrls(stack)
  // No frames parsed is not evidence of anything — keep the report.
  if (!urls.length) return false
  return urls.every((url) => scrubUrl(url) === documentUrl)
}

/**
 * React's hydration-mismatch family, which a page TRANSLATOR causes and a
 * real render divergence also causes.
 *
 * These are `onRecoverableError` reports, not crashes: React has already
 * re-rendered on the client and the visitor has a working page. They arrive
 * here as uncaught errors only because React re-throws them to `reportError`.
 *
 * They are marked rather than dropped, and the distinction is the whole
 * design. Dropping would hide a real hydration regression, which is a genuine
 * and expensive bug; the entries stay in `client-errors` at full severity and
 * still group in Error Reporting. What the mark buys is that the log-match
 * policy can stop paging for ONE visitor whose browser rewrote the DOM, while
 * a rate-based policy on the same mark still catches a systemic one.
 *
 * Measured 2026-09-01: eight #418 reports inside a nine-minute window, one
 * build, three different pages — one visitor, and the same pages loaded with
 * a clean console the next day.
 */
const HYDRATION_MINIFIED = /Minified React error #(?:418|423|425)\b/
const HYDRATION_TEXT =
  /Hydration failed because|Text content does not match server-rendered HTML|There was an error while hydrating/

export function isHydrationMismatch(message: string): boolean {
  return HYDRATION_MINIFIED.test(message) || HYDRATION_TEXT.test(message)
}

let installed = false

/**
 * The live beacon's `enqueue`, published for {@link reportHandledError}.
 *
 * Null until `installErrorBeacon` runs, and null forever on a surface that
 * never installs one — so a caught error reported from a page with no beacon
 * is silently dropped rather than throwing inside somebody's error handler.
 */
let publishEvent: ((event: ErrorBeaconEvent) => void) | null = null

/**
 * Report an error the code ALREADY CAUGHT.
 *
 * The two window handlers below see only what nothing caught. A `catch` that
 * swallows its error is invisible to them by construction, which is the whole
 * failure mode this exists for: a background write that can only fail
 * silently is one that stays broken for as long as nobody thinks to look.
 *
 * It rides the same queue as an uncaught error, which is the point — the
 * dedupe collapses a failure that repeats on every edit into one report, and
 * `maxPerPage` bounds it, so a call site in a loop cannot turn a broken
 * feature into a flood. Reporting is never worth an exception of its own, so
 * every path here returns rather than throws.
 */
export function reportHandledError(
  error: unknown,
  options?: { kind?: string },
): void {
  try {
    if (!publishEvent) return
    const thrown = error as Error | undefined
    const message = clamp(
      thrown?.message ?? (typeof error === 'string' ? error : ''),
      MAX_MESSAGE,
    )
    if (!message) return
    publishEvent({
      kind: clamp(options?.kind ?? 'handled', 32),
      message,
      stack: thrown?.stack ? clamp(thrown.stack, MAX_STACK) : undefined,
      url: scrubUrl(window.location.href),
    })
  } catch {
    // An observer that throws is worse than one that misses an event.
  }
}

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
  // Published AFTER the sample-rate return above, so an unsampled pageview
  // reports nothing by either door rather than one by one and none by the
  // other.
  publishEvent = enqueue

  window.addEventListener('error', (event) => {
    try {
      const error = event.error as Error | undefined
      const message = clamp(error?.message ?? event.message, MAX_MESSAGE)
      // Cross-origin scripts yield an opaque "Script error." with nothing
      // actionable attached; reporting it would only create a noisy group.
      if (!message || message === 'Script error.') return
      const pageUrl = scrubUrl(window.location.href)
      const stack = error?.stack ? clamp(error.stack, MAX_STACK) : undefined
      // A webview or extension that evaluated its own code into our page —
      // see `isInjectedThirdPartyFrame`. Nothing we ship can be changed in
      // response, so it is dropped on the same test as `Script error.`.
      if (stack && isInjectedThirdPartyFrame(stack, pageUrl)) return
      enqueue({
        // MARKED, not dropped: a translator causes these and so does a real
        // render divergence, and only a rate tells them apart.
        kind: isHydrationMismatch(message) ? 'hydration' : 'error',
        message,
        stack,
        source: scrubUrl(event.filename) || undefined,
        line: typeof event.lineno === 'number' ? event.lineno : undefined,
        col: typeof event.colno === 'number' ? event.colno : undefined,
        url: pageUrl,
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
