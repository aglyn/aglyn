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

import { browserFamily, type BrowserFamily } from './browser-family'
import { isCrossPoolDesync } from './cross-pool-desync'
import { isForeignScriptUrl, stackFrameUrls } from './foreign-script'
import { isStaleBuildError, recoverStaleBuildRejection } from './stale-build-error'

export interface ErrorBeaconEvent {
  /**
   * Which handler caught it — 'error' | 'unhandledrejection' — or the
   * family it was labeled with: 'hydration', {@link AUTH_DESYNC_KIND},
   * {@link CHUNK_LOAD_KIND}, or a caller's own kind for a handled error.
   * Lands at `jsonPayload.kind`, where the alert policies filter on it.
   */
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
  /**
   * On a `hydration` event from builds before AGL-3738 only: the page
   * translator whose rewrite was visible in the document when React gave up
   * — see {@link pageTranslationSignal}. Today's beacon drops a mismatch on a
   * translated page instead of sending it, so the field stays only for what
   * older tabs still report.
   */
  translated?: string
  /** On a `hydration` event only: `navigator.language`, clamped. */
  language?: string
  /**
   * On every event: the coarse browser family — one of seven, see
   * {@link browserFamily} (AGL-3732). Never the user agent, never a version.
   * Stamped by the queue, so a caller never sets it.
   */
  browser?: BrowserFamily
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
 * Was this thrown by a script somebody ELSE evaluated into our page?
 *
 * Three tells, all read off the frames' positions and none off a function
 * name — a name would be a denylist needing a new entry per vendor.
 *
 * **Every frame is the DOCUMENT.** Measured 2026-09-02 (AGL-2523) on
 * aglyn.com/pricing, reported as an error of ours:
 *
 *     sendDataToNative@https://aglyn.com/pricing:1:1325
 *     sendPageHideMessage@https://aglyn.com/pricing:1:4139
 *     @https://aglyn.com/pricing:1:6257
 *
 * `sendDataToNative` is the Meta in-app browser's native bridge, injected by
 * the Facebook/Instagram webview. In WebKit's format the code was evaluated
 * inline, so every frame is the document rather than a script we served.
 *
 * **Every frame is under a FOREIGN scheme.** Measured 2026-09-10 (AGL-2786) on
 * aglyn.com, the same bridge in the Android webview:
 *
 *     at sendDataToNative (iabjs://navigation_performance_logger_android:1:10632)
 *
 * That webview names its scripts under its own `iabjs://` scheme, and
 * extensions do the same under theirs — see `FOREIGN_SCRIPT_SCHEMES`.
 *
 * **Every frame is a script with NO URL** (AGL-3423). Measured on the
 * sign-up page and on aglyn.com/solutions/agencies:
 *
 *     at eval (<anonymous>)
 *     at predicate (eval at evaluate (:234:30), <anonymous>:11:37)
 *
 *     at <anonymous>:1:54
 *     at <anonymous>:1:64
 *
 * An automation driver's `evaluate` and a snippet pasted into devtools. Every
 * script we serve has a URL — a chunk, a CDN asset, or the document for an
 * inline one — so a frame whose position is `<anonymous>:line:col`, or code
 * `eval`'d by such a frame, was not served by us. See
 * {@link anonymousScriptFrameCount} for exactly which frames count.
 *
 * ⚑ Deliberately `every`, and deliberately compared against the document
 * rather than against our asset path. A rule like "no frame under
 * `/_next/static/`" would delete EVERY error from a self-hosted deployment
 * that serves its assets from a CDN, because none of its frames would match.
 * Comparing to the document cannot fail that way: a CDN frame is not the
 * document either, so it keeps the report.
 *
 * A stack may mix the tells frame by frame. Nothing we ship can be fixed in
 * response to any of them, which is the same test the opaque `Script error.`
 * cut already applies.
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
  // No frames parsed is not evidence of anything — keep the report. A stack
  // with neither a URL nor an anonymous-script frame is exactly that: an
  // empty frame list must never read as "every frame is injected".
  if (!urls.length && !anonymousScriptFrameCount(stack)) return false
  // Anonymous frames need no test of their own — they are injected by
  // definition — so `every` over the URLs is `every` over the whole stack.
  // One URL of ours, even as the origin of an `eval`, keeps the report.
  return urls.every(
    (url) => isForeignScriptUrl(url) || scrubUrl(url) === documentUrl,
  )
}

/** A frame line, in V8's `at …` format or WebKit/Firefox's `fn@location`. */
const STACK_FRAME_LINE = /^\s*at\s|@/

/**
 * A position in a script that has no URL.
 *
 * - `<anonymous>:line:col` — V8's name for such a script, both for a top-level
 *   snippet and as the position of code run through `eval`/`new Function`.
 * - `eval at …` — V8's origin of `eval`'d code. When OUR script ran the eval
 *   its URL is inside this origin, `stackFrameUrls` reads it, and the report
 *   is kept; that is how the marketing plugin's `runJs` step stays reported.
 * - `debugger eval code:line:col` — Firefox's devtools console, in the
 *   `fn@location` format WebKit also uses.
 *
 * ⚑ A BARE `(<anonymous>)` with no line and column is NOT one of these. It is
 * how V8 prints a builtin — `at Array.forEach (<anonymous>)`,
 * `at JSON.parse (<anonymous>)` — and a builtin is called by whoever called
 * it, including us.
 */
const ANONYMOUS_SCRIPT_POSITION =
  /<anonymous>:\d+:\d+|\beval at\s|\bdebugger eval code:\d+:\d+/

/** How many frames of this stack are in a script with no URL at all. */
export function anonymousScriptFrameCount(stack: string): number {
  let count = 0
  for (const line of stack.split('\n')) {
    if (STACK_FRAME_LINE.test(line) && ANONYMOUS_SCRIPT_POSITION.test(line)) {
      count += 1
    }
  }
  return count
}

/**
 * Browser notices that are not failures, and that no fix of ours could act on.
 *
 * `ResizeObserver loop completed with undelivered notifications` (and its older
 * wording, `ResizeObserver loop limit exceeded`) is the browser saying it
 * deferred some resize callbacks to the next frame. Nothing threw: the event
 * carries no error object and no stack, and every observer is still
 * delivered. It arrived from the Besigner on 2026-09-26 and paged. Dropped, on
 * the browser's exact wording.
 */
const BENIGN_BROWSER_NOTICE =
  /^(?:Uncaught )?(?:Error: )?ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/

export function isBenignBrowserNotice(message: string): boolean {
  return BENIGN_BROWSER_NOTICE.test(message)
}

/**
 * Whether the document is a page a visitor navigated to over the web
 * (AGL-3759).
 *
 * Only `http:` and `https:` qualify. A document at `about:blank` or
 * `about:srcdoc` is a COPY of our page: a translator extension or a site that
 * frames our markup renders it into a fresh document with no URL of its own,
 * and our scripts run there too. Next.js's app router then throws
 * `Failed to construct 'URL': Invalid URL` resolving its canonical URL against
 * `window.location.href`, which no code of ours can prevent and no visitor on
 * the real page ever sees. `file:` (a saved page) and an extension's own
 * scheme are copies in the same sense.
 *
 * A missing or unreadable location is not a web document either: nothing
 * from it can be traced to a page we serve.
 */
export function isWebDocument(
  location: { protocol?: string } | null | undefined,
): boolean {
  try {
    const protocol = location?.protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A rejection that says only "this was cancelled" (AGL-3734).
 *
 * `AbortError` is what a request rejects with when its `AbortSignal` fires —
 * a deadline we set, a component that unmounted, a search the author typed
 * past — and what the browser rejects every in-flight fetch with when the
 * document goes away under it. On 2026-10-10 one arrived from
 * `/edit-access`, the page a published site opens in a popup or a hidden
 * iframe and then CLOSES itself the moment it has its answer. The report had
 * no stack and no message past the name, so there was no call site to fix:
 * the page's own mint was already caught, and whatever else the console shell
 * had in flight was cut off by the site ending the page, which is the flow
 * working.
 *
 * Why the classifier rather than each call site: every request on every
 * console page can be the one in flight when a page is torn down, and the
 * abort is the intended outcome in every case. There is nothing a fix of ours
 * could change, and nothing in the report to locate it by.
 *
 * Narrow on purpose. Only `name === 'AbortError'`, and only for an UNHANDLED
 * REJECTION — not `TimeoutError`, which is `AbortSignal.timeout` saying a
 * deadline was MISSED (a real slowness), and not an uncaught `error` event or
 * a `reportHandledError` call, where somebody chose to report it.
 */
export function isAbortRejection(reason: unknown): boolean {
  try {
    return (
      typeof reason === 'object' &&
      reason !== null &&
      (reason as { name?: unknown }).name === 'AbortError'
    )
  } catch {
    // A getter that throws leaves the rejection reported, never dropped.
    return false
  }
}

/**
 * `kind` for Firebase's `auth/tenant-id-mismatch` — a sibling tab signed in to
 * another account pool (AGL-3280). The console recovers the tab by reloading
 * it once it is hidden and deliberately leaves the rejection unhandled so it
 * is still seen; this label is what lets it be seen by RATE instead of paging
 * on each of the several rejections one storage event raises.
 */
export const AUTH_DESYNC_KIND = 'auth-desync'

/**
 * `kind` for a chunk the document names and the origin no longer serves
 * (AGL-3279). Every boundary reloads once for it; what still arrives is the
 * failure the reload did not cure. One of those is a visitor on a bad
 * connection; a burst of them is a broken deploy, which only a rate can tell.
 */
export const CHUNK_LOAD_KIND = 'chunk-load'

/**
 * `kind` for reCAPTCHA's own `reCAPTCHA Timeout` rejection (AGL-4068).
 *
 * App Check's reCAPTCHA provider loads Google's script, and that script
 * rejects a promise of its own when its iframe does not answer in time: a
 * tab throttled in the background, a slow or blocked `gstatic.com`. No call
 * site of ours awaits it, so it lands as an unhandled rejection whose whole
 * stack is Google's script. App Check retries with backoff on the next token
 * request, so the visitor's page keeps working. One of these is a slow
 * network; a burst is App Check failing for everyone, which only a rate can
 * tell. Two arrived on 2026-10-25 and each paged.
 */
export const RECAPTCHA_TIMEOUT_KIND = 'recaptcha-timeout'

const RECAPTCHA_TIMEOUT_MESSAGE = /^(?:Error: )?reCAPTCHA Timeout\b/

/** Google's reCAPTCHA scripts, wherever the provider loads them from. */
const RECAPTCHA_SCRIPT_URL =
  /^https:\/\/(?:www\.)?(?:gstatic\.com|google\.com|recaptcha\.net)\/recaptcha\//

/**
 * reCAPTCHA's timeout, by its wording AND by a stack that is only Google's
 * script. A message alone is not enough: one of our frames in the stack means
 * our code chose to throw that text, and that stays reported as itself.
 */
export function isRecaptchaTimeout(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message !== 'string' || !RECAPTCHA_TIMEOUT_MESSAGE.test(message)) {
    return false
  }
  const stack = (error as { stack?: unknown }).stack
  if (typeof stack !== 'string') return true
  return stackFrameUrls(stack).every((url) => RECAPTCHA_SCRIPT_URL.test(url))
}

/**
 * The label for a fault we RECOVER from and still want to see, or undefined.
 *
 * These could be ours, so unlike an injected stack they are never dropped:
 * they are written at full severity under their own `kind`, the per-entry
 * policy excludes that kind, and a rate policy watches it — the same split
 * `hydration` already has.
 */
export function recoveredErrorKind(error: unknown): string | undefined {
  try {
    if (isCrossPoolDesync(error)) return AUTH_DESYNC_KIND
    if (isStaleBuildError(error)) return CHUNK_LOAD_KIND
    if (isRecaptchaTimeout(error)) return RECAPTCHA_TIMEOUT_KIND
  } catch {
    // A getter that throws leaves the event unlabeled, never unreported.
  }
  return undefined
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
 * policy can stop paging on a single report, while a rate-based policy on the
 * same mark still catches a systemic one.
 *
 * ⚠️ THE MARK IS NOT A VERDICT, and the one cluster this repo has measured is
 * why. Eight #418 reports arrived inside a nine-minute window on 2026-09-01,
 * on one build, and the three pages they came from were exactly the three
 * carrying a form — `/`, `/pricing` and the solutions pages reported nothing
 * in the same window, which no browser-side rewrite would respect. A placed
 * form was expanding inside its own grafted subtree, so every page carrying
 * one shipped six nested `<form>` elements; nested forms are invalid HTML, the
 * parser dropped the inner ones, and the client tree disagreed with the server
 * tree. The visible cost was a submission the route never received, because
 * the native submit came from an unhandled ancestor and the browser fell back
 * to a GET with the visitor's name, email and message in the address bar. The
 * reports stopped because the nesting was fixed, roughly a quarter of an hour
 * after the last one.
 *
 * So a rate low enough not to page is a reason to READ the entry — the page
 * it names, and whether the set of pages has a shape — never a reason to
 * assume somebody's extension.
 */
const HYDRATION_MINIFIED = /Minified React error #(?:418|423|425)\b/
const HYDRATION_TEXT =
  /Hydration failed because|Text content does not match server-rendered HTML|There was an error while hydrating/

export function isHydrationMismatch(message: string): boolean {
  return HYDRATION_MINIFIED.test(message) || HYDRATION_TEXT.test(message)
}

/**
 * WHICH TRANSLATOR rewrote this page's text, read off the document, or
 * undefined when none visibly did.
 *
 * A hydration report on its own cannot say whether React disagreed with our
 * server render or with a translator that rewrote the server's text before
 * React reached it, and the two look identical in `client-errors`: the
 * minified #418, a stack inside the react-dom chunk, the page URL, nothing
 * else. aglyn.com/ carried eight of them between 2026-09-22 and 2026-10-10.
 * The visitor at 2026-10-09 22:28Z went on to sign up two minutes later with
 * Chrome Translate rewriting the console (the `<font>` crash #1342 fixed); the
 * two on 2026-09-22/23 were desktop Chrome OS in Hyderabad, while every other
 * Indian, Pakistani and Turkish home-page visit in GA that fortnight hydrated
 * without a report — so neither the build nor the time zone was the variable,
 * and the beacon had nothing to say which visitor it was.
 *
 * The signatures are the ones each translator leaves on the DOM it rewrote:
 *
 * - Chrome (and every Chromium that ships Google Translate) sets
 *   `translated-ltr` / `translated-rtl` on `<html>` and wraps each rewritten
 *   run in `<font style="vertical-align: inherit;">`.
 * - Microsoft Translator (Edge) stamps `_msttexthash` / `_msthash` on every
 *   element whose text it replaced.
 * - Any translator that does the job properly rewrites `<html lang>`, which is
 *   compared against the `servedLang` the beacon read at install, before
 *   hydration began.
 *
 * Never throws: it runs inside the error handler.
 */
export function pageTranslationSignal(
  doc: Document,
  servedLang: string | null | undefined,
): string | undefined {
  try {
    const root = doc.documentElement
    if (!root) return undefined
    if (
      root.classList.contains('translated-ltr') ||
      root.classList.contains('translated-rtl') ||
      doc.querySelector('font[style*="vertical-align: inherit"]')
    ) {
      return 'chrome'
    }
    if (doc.querySelector('[_msttexthash], [_msthash]')) return 'microsoft'
    const lang = root.getAttribute('lang')
    if (servedLang && lang && lang.toLowerCase() !== servedLang.toLowerCase()) {
      return `lang:${clamp(lang, 16)}`
    }
  } catch {
    // An unreadable document leaves the event unlabeled, never unreported.
  }
  return undefined
}

/**
 * A TRANSLATOR'S MARK, REMEMBERED FROM THE MOMENT IT APPEARS (AGL-3738).
 *
 * {@link pageTranslationSignal} read at the moment React reports a mismatch
 * is reading a document the translator no longer owns. React reports a
 * hydration mismatch only after it has client-rendered the root to recover,
 * and that render resets `<html>`'s attributes to the ones it rendered —
 * Chrome's `translated-ltr` class goes, `lang` returns to the served value —
 * and replaces every `<font>` wrapper and hash-stamped element with fresh
 * nodes. Measured 2026-10-12 by hydrating aglyn.com/ with a Chrome-style
 * rewrite of one heading: the report fired with `<html lang="en">`, no class
 * and no `<font>` left anywhere. Six es-US #418s arrived that day on
 * aglyn.com/ and orbita-digital.aglyn.app/ (a Spanish site served as `en`);
 * one carried `lang:en` — the beacon had been installed after the translator
 * set `lang="es"`, so React's reset was the only rewrite left to see, and the
 * same simulation reproduces exactly that label — and the other five carried
 * nothing. The same two pages hydrated cleanly under es-US, en-GB and ru
 * locales and time zones: nothing on them formats by the visitor's locale.
 *
 * So the mark is read when the translator LEAVES it: once at install, for a
 * translator that ran first, and then from a `MutationObserver` until one is
 * seen. A translator rewrites the page before React reaches it — that is what
 * makes it a mismatch — so its mutations are delivered before the report.
 *
 * Cheap on purpose: one observer on `<html>`'s own `class`/`lang`, and one on
 * the tree that looks only at added `<font>` elements and Microsoft's hash
 * attributes, both disconnected as soon as a mark is found. Never throws, and
 * a browser without `MutationObserver` gets the read-at-report behavior.
 */
export function watchPageTranslation(
  doc: Document,
  servedLang: string | null | undefined,
): () => string | undefined {
  let seen = pageTranslationSignal(doc, servedLang)
  const observers: MutationObserver[] = []

  const stop = () => {
    for (const observer of observers.splice(0)) observer.disconnect()
  }

  const inspect = (records: MutationRecord[]) => {
    if (seen) return
    let relevant = false
    for (const record of records) {
      if (record.type === 'attributes') {
        relevant = true
        break
      }
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeName === 'FONT') {
          relevant = true
          break
        }
      }
      if (relevant) break
    }
    if (!relevant) return
    seen = pageTranslationSignal(doc, servedLang)
    if (seen) stop()
  }

  try {
    const root = doc.documentElement
    if (!seen && root && typeof MutationObserver === 'function') {
      const onRoot = new MutationObserver(inspect)
      onRoot.observe(root, { attributes: true, attributeFilter: ['class', 'lang'] })
      const onTree = new MutationObserver(inspect)
      onTree.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['_msttexthash', '_msthash'],
      })
      observers.push(onRoot, onTree)
    }
  } catch {
    // No observer: the report falls back to reading the document as it is.
  }

  return () => {
    try {
      // A rewrite in the same task as the report has not been delivered yet.
      for (const observer of observers) inspect(observer.takeRecords())
      return seen ?? pageTranslationSignal(doc, servedLang)
    } catch {
      return undefined
    }
  }
}

/**
 * WHAT A REJECTED PROMISE ACTUALLY CARRIED (AGL-3279).
 *
 * `unhandledrejection` hands over whatever was passed to `reject`, and only
 * an `Error` brings a message and a stack. A rejection with anything else —
 * an API's `{ code, message }` object, a `DOMException` from an aborted
 * fetch, a bare string, a `Response` — used to be reported as the literal
 * words "Unhandled promise rejection" with no stack and no other field,
 * which names the handler rather than the failure. One such report arrived
 * on 2026-09-21 from the Besigner editor and there is nothing in it to act
 * on: no message, no stack, no code, nothing but the page.
 *
 * So the value is DESCRIBED rather than defaulted. In order of how much a
 * reader can do with it: the error's own message; a string as itself; a
 * `name`/`code`/`message` shape assembled from whatever of those it has —
 * the shape every Firebase, DOM and fetch rejection takes; the value's own
 * `toString` when it says more than `[object Object]`; and last its own
 * keys, which at least name what kind of thing rejected.
 *
 * Nothing here may throw: a getter on the reason can, `toString` can, and
 * a describer that throws inside the rejection handler loses the report it
 * was called to improve.
 */
export function describeRejectionReason(reason: unknown): string {
  try {
    if (reason instanceof Error && reason.message) return reason.message
    if (typeof reason === 'string') return reason
    if (reason === null || reason === undefined) {
      return `Unhandled promise rejection (${String(reason)})`
    }
    if (typeof reason !== 'object') {
      return `Unhandled promise rejection (${typeof reason}: ${String(reason)})`
    }
    const shape = reason as Record<string, unknown>
    const named = [
      shape['name'] ?? shape['code'] ?? '',
      shape['message'] ?? shape['statusText'] ?? '',
    ]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
    if (named.length) return named.join(': ')
    const printed = String(reason)
    if (printed && printed !== '[object Object]') return printed
    const keys = Object.keys(shape).slice(0, 12).join(', ')
    return keys
      ? `Unhandled promise rejection (object with ${keys})`
      : 'Unhandled promise rejection (empty object)'
  } catch {
    return 'Unhandled promise rejection (undescribable)'
  }
}

/**
 * How many frames a thrown error keeps, on a pageview that reports (AGL-3423).
 *
 * V8 keeps ten by default, and ten is not enough to find where a render loop
 * STARTED. The Besigner's one React #185 report (2026-09-24) was a
 * react-final-form field's `setState` inside final-form's `notify` loop, and
 * every one of its ten frames was inside those two libraries: the component
 * whose update fed the loop was cut off below them. Fifty reaches past a
 * form library's own frames to ours, and still fits the {@link MAX_STACK}
 * clamp at the length a minified frame line has.
 */
export const BEACON_STACK_TRACE_LIMIT = 50

/**
 * Raises the engine's frame limit to `limit`, never lowers it. V8 and
 * JavaScriptCore read `Error.stackTraceLimit`; an engine that does not has no
 * such number, and is left without one rather than handed a property it
 * ignores. It applies to errors created after the call, which is why the
 * beacon sets it at install, at module scope of the app's first client chunk.
 */
export function raiseStackTraceLimit(limit: number): void {
  try {
    const engine = Error as ErrorConstructor & { stackTraceLimit?: number }
    const current = engine.stackTraceLimit
    if (typeof current !== 'number' || current >= limit) return
    engine.stackTraceLimit = limit
  } catch {
    // A frozen or exotic `Error` keeps its own limit.
  }
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
 * Re-export so `error-beacon` stays the one name a caller has to know for
 * browser error reporting. The definition lives in its own module because a
 * boundary that imports it must not pull the installer below into a chunk
 * every visitor downloads.
 */
export { redispatchCaughtError } from './redispatch-caught-error'

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
  // Only a sampled pageview REPORTS. Every pageview recovers a stale build
  // (the rejection handler below), because a tab left on a dead deploy is a
  // visitor's problem whether or not its errors are counted.
  const sampled = Math.random() < sampleRate
  // A copy of the page in a document that is not on the web reports nothing
  // by either door, whatever it throws: see `isWebDocument`.
  const reporting = sampled && isWebDocument(window.location)
  // The document's language as SERVED, read before hydration and before any
  // translator has had a chance to rewrite it (`pageTranslationSignal`).
  const servedLang = document.documentElement?.getAttribute('lang') ?? null
  // Watched from now, because React's recovery erases the translator's marks
  // before a mismatch is reported (`watchPageTranslation`, AGL-3738).
  const translation = watchPageTranslation(document, servedLang)
  if (reporting) raiseStackTraceLimit(BEACON_STACK_TRACE_LIMIT)
  // Classified once, here, and only the family is kept: the user-agent
  // string itself never reaches the queue (AGL-3732).
  let browser: BrowserFamily = 'other'
  try {
    browser = browserFamily(navigator.userAgent)
  } catch {
    // An unreadable navigator is just `other`.
  }

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
    if (!reporting || sent >= maxPerPage) return
    // Message + first stack line: enough identity to collapse a render loop
    // without collapsing distinct errors that share a message.
    const key = `${event.message}\x00${(event.stack ?? '').split('\n', 2).join('\n')}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    queued.push({ ...event, browser })
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS)
  }
  // Null on a pageview that does not report, so it reports nothing by either
  // door rather than one by one and none by the other.
  publishEvent = reporting ? enqueue : null

  window.addEventListener('error', (event) => {
    try {
      const error = event.error as Error | undefined
      const message = clamp(error?.message ?? event.message, MAX_MESSAGE)
      // Cross-origin scripts yield an opaque "Script error." with nothing
      // actionable attached; reporting it would only create a noisy group.
      if (!message || message === 'Script error.') return
      if (isBenignBrowserNotice(message)) return
      const pageUrl = scrubUrl(window.location.href)
      const fullStack = error?.stack ? String(error.stack) : undefined
      // A webview or extension that evaluated its own code into our page —
      // see `isInjectedThirdPartyFrame`. Nothing we ship can be changed in
      // response, so it is dropped on the same test as `Script error.`.
      // Judged on the WHOLE stack, before the clamp: a frame of ours past the
      // clamp still makes the error ours.
      if (fullStack && isInjectedThirdPartyFrame(fullStack, pageUrl)) return
      const stack = fullStack ? clamp(fullStack, MAX_STACK) : undefined
      // MARKED, not dropped: a translator causes a hydration mismatch and so
      // does a real render divergence, and a recovered fault is still a
      // fault. Only a rate tells either apart from noise — and the
      // translator's own mark on the DOM, when it left one.
      const kind =
        recoveredErrorKind(error ?? { message }) ??
        (isHydrationMismatch(message) ? 'hydration' : 'error')
      const translated = kind === 'hydration' ? translation() : undefined
      // A mismatch on a page a translator rewrote is the translator's, not
      // ours (AGL-3738): React compared our render with text we did not
      // write, recovered, and the visitor has a working page. Nothing we ship
      // can change in response, so it goes the way of an injected stack. The
      // mark is evidence on the document, not a guess about the visitor — an
      // unmarked mismatch is still reported, and still the one to read.
      if (translated) return
      enqueue({
        kind,
        message,
        stack,
        source: scrubUrl(event.filename) || undefined,
        line: typeof event.lineno === 'number' ? event.lineno : undefined,
        col: typeof event.colno === 'number' ? event.colno : undefined,
        url: pageUrl,
        ...(kind === 'hydration' && navigator.language
          ? { language: clamp(navigator.language, 16) }
          : {}),
      })
    } catch {
      // Never rethrow from an error handler.
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    try {
      // An `import()` of a chunk this document names and the origin dropped,
      // which no boundary saw. Recovered by a reload once the tab is hidden,
      // and, like a boundary's reload, not reported: see
      // `recoverStaleBuildRejection`. A tab whose recovery is spent still
      // reports it, as `chunk-load`.
      if (recoverStaleBuildRejection(event.reason)) return
      // A cancelled request, ours or the browser's on teardown: see
      // `isAbortRejection` for why this is dropped and how narrowly.
      if (isAbortRejection(event.reason)) return
      const reason = event.reason as Error | undefined
      const message = clamp(describeRejectionReason(event.reason), MAX_MESSAGE)
      if (!message) return
      const pageUrl = scrubUrl(window.location.href)
      const fullStack = reason?.stack ? String(reason.stack) : undefined
      // The same injected-code drop as an uncaught error: a rejection raised
      // by a devtools snippet or an automation driver's `evaluate` is no more
      // ours for having been a promise.
      if (fullStack && isInjectedThirdPartyFrame(fullStack, pageUrl)) return
      enqueue({
        kind: recoveredErrorKind(event.reason) ?? 'unhandledrejection',
        message,
        stack: fullStack ? clamp(fullStack, MAX_STACK) : undefined,
        url: pageUrl,
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
