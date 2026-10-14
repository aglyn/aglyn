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
 * The coarse browser FAMILY an error report carries (AGL-3732).
 *
 * React #418 kept arriving from en-GB visitors on aglyn.com with no
 * translator on the page and no way to reproduce it, and the report could not
 * say what browser it came from. This answers that one question and nothing
 * finer: one family out of seven, never the user-agent string and never a
 * version, so it narrows a cluster without identifying a visitor.
 *
 * Order matters, and every test reads a token the browser itself puts there:
 *
 * - **webview first.** An Android WebView marks itself `; wv)`. On iOS every
 *   browser is WebKit; Safari and the real third-party browsers say who they
 *   are (`Safari/`, `CriOS`, `FxiOS`, `EdgiOS`), and an app's WKWebView —
 *   Instagram, Facebook, a mail client — carries no `Safari/` token, or its
 *   own `FBAN`/`Instagram` marker. An in-app browser injects into and
 *   rewrites the DOM, which is exactly what a hydration mismatch looks like,
 *   so it is its own family.
 * - **edge and samsung before chrome**, because both also say `Chrome/`.
 * - **firefox** on `Firefox/` and `FxiOS`.
 * - **chrome** on `Chrome/`/`CriOS`/`Chromium`; Chromium brands that rename
 *   themselves (Opera's `OPR/`, Yandex's `YaBrowser/`) are `other`.
 * - **safari** last: `Safari/` with no Chromium token.
 *
 * Pure and total: anything it cannot place, including no string at all, is
 * `other`. No `'use client'` — see the note atop `error-beacon.ts`; the
 * ingest route imports {@link isBrowserFamily} on the server.
 */

export const BROWSER_FAMILIES = [
  'safari',
  'chrome',
  'firefox',
  'edge',
  'samsung',
  'webview',
  'other',
] as const

export type BrowserFamily = (typeof BROWSER_FAMILIES)[number]

const FAMILY_SET: ReadonlySet<string> = new Set(BROWSER_FAMILIES)

/** True only for one of the seven values the beacon writes. */
export function isBrowserFamily(value: unknown): value is BrowserFamily {
  return typeof value === 'string' && FAMILY_SET.has(value)
}

const IOS_DEVICE = /\b(?:iPhone|iPad|iPod)\b/
const IN_APP_MARKER = /\b(?:FBAN|FBAV|FB_IAB|Instagram|Line)[/\s]/

export function browserFamily(userAgent: unknown): BrowserFamily {
  if (typeof userAgent !== 'string' || !userAgent) return 'other'
  const ua = userAgent
  if (/;\s*wv\)/.test(ua)) return 'webview'
  if (IOS_DEVICE.test(ua)) {
    if (IN_APP_MARKER.test(ua)) return 'webview'
    if (/\bEdgiOS\//.test(ua)) return 'edge'
    if (/\bFxiOS\//.test(ua)) return 'firefox'
    if (/\bCriOS\//.test(ua)) return 'chrome'
    return /\bSafari\//.test(ua) ? 'safari' : 'webview'
  }
  if (/\bEdg(?:e|A)?\//.test(ua)) return 'edge'
  if (/\bSamsungBrowser\//.test(ua)) return 'samsung'
  if (/\bFirefox\//.test(ua)) return 'firefox'
  if (/\b(?:OPR|Opera|YaBrowser)\//.test(ua)) return 'other'
  if (/\b(?:Chrome|Chromium)\//.test(ua)) return 'chrome'
  if (/\bSafari\//.test(ua)) return 'safari'
  return 'other'
}
