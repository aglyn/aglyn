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
 * Code running in our pages that no deployment of ours served (AGL-2786).
 *
 * Two collectors have to tell our code from somebody else's running inside
 * the same document, and both answer it from a URL: the CSP collector off a
 * violation's source or blocked URI, the error beacon off every frame of a
 * stack. They read ONE list, because a second copy fails silently — a scheme
 * learned in one place goes on paging from the other.
 *
 * Pure and framework-free: the beacon ships in every page's client bundle and
 * the ingestion routes run the same rule on the server, so nothing here may
 * reach `window` or a Node builtin.
 */

/**
 * Schemes no deployment of ours serves a script from.
 *
 * - Extension content scripts, the overwhelming majority of CSP reports on
 *   any real deployment: `chrome-extension:`, `moz-extension:`,
 *   `safari-extension:`, `safari-web-extension:`, `edge-extension:`.
 * - `webkit-masked-url:` — Safari's redaction of the same thing. Opaque, so
 *   it can never be actioned, and it arrives in volume.
 * - `chrome:`, `resource:`, `asset:` — the browser's and the embedding app's
 *   own internals.
 * - `iabjs:` — the scheme Meta's Facebook/Instagram Android in-app browser
 *   evaluates its own scripts under. Measured 2026-09-10 in `client-errors`:
 *   `Error invoking postMessage: Java object is gone`, every frame under
 *   `iabjs://navigation_performance_logger_android`, thrown by the webview's
 *   native bridge as the page unloaded.
 *
 * Schemes, not vendors or function names: a new webview adds a scheme at
 * most, and nothing on this list can ever be ours.
 */
export const FOREIGN_SCRIPT_SCHEMES: readonly string[] = [
  'chrome-extension:',
  'moz-extension:',
  'safari-extension:',
  'safari-web-extension:',
  'edge-extension:',
  'webkit-masked-url:',
  'chrome:',
  'resource:',
  'asset:',
  'iabjs:',
]

/** Is this URL under a scheme no deployment of ours serves? */
export function isForeignScriptUrl(value: string): boolean {
  const lowered = value.toLowerCase()
  return FOREIGN_SCRIPT_SCHEMES.some((scheme) => lowered.startsWith(scheme))
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
 *
 * ANY scheme, not a list of web ones. A frame the pattern cannot read does
 * not parse, and a stack made only of such frames reads as "no frames" —
 * which every caller treats as no evidence and keeps. That is how an
 * `iabjs://` stack came to be reported as ours.
 */
export function stackFrameUrls(stack: string): string[] {
  const urls: string[] = []
  const frame = /([a-z][a-z0-9+.-]*:\/\/[^\s()]+?):\d+:\d+/gi
  let match: RegExpExecArray | null
  while ((match = frame.exec(stack)) !== null) urls.push(match[1])
  return urls
}

/**
 * Was every frame of this stack evaluated under a foreign scheme?
 *
 * ⚑ `every`, never `some`: injected code calling into ours is OUR bug the
 * moment one of our frames is on the stack, so a single first-party frame —
 * a served chunk, a CDN asset, the document itself — keeps the report.
 *
 * No frames parsed is not evidence of anything, so it is false.
 *
 * The document is NOT foreign here. The beacon also drops a stack whose
 * frames are the document (see `isInjectedThirdPartyFrame`), but only for an
 * uncaught error, in the browser, against the page's own URL. Anything
 * reading a stack without that context must not guess.
 */
export function isForeignScriptStack(stack: string): boolean {
  const urls = stackFrameUrls(stack)
  if (!urls.length) return false
  return urls.every((url) => isForeignScriptUrl(url))
}
