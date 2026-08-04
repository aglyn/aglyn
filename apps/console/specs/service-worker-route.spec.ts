/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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
 * AGL-1053: `/sw.js` must reach the browser as a script.
 *
 * The console's middleware matcher covers everything that is not an asset or
 * an API route, and it can answer with a **redirect** — the workspace gate and
 * the auth bounce both do. A redirect served in place of the worker fails
 * registration with a content-type error that names nothing useful, and the
 * matcher is a regex nobody re-reads, so this asserts the exclusion at the
 * declaration rather than hoping a browser check catches it later.
 *
 * The matcher is evaluated the way Next evaluates it — as a regex against the
 * path — instead of being string-matched, so it stays true if the pattern is
 * reformatted or the exclusions reordered.
 */

import { config } from '../middleware'

/** Next's matcher entries are path regexes anchored at both ends. */
const matches = (path: string): boolean =>
  (config.matcher as string[]).some((pattern) =>
    new RegExp(`^${pattern}$`).test(path),
  )

describe('middleware matcher and the service worker (AGL-1053)', () => {
  it('does NOT run middleware for /sw.js', () => {
    // The whole point: middleware can redirect, and a redirect is not a script.
    expect(matches('/sw.js')).toBe(false)
  })

  it('CONTROL — it DOES run for an ordinary page', () => {
    // Without this, an exclusion that accidentally matched everything (or a
    // broken regex that matched nothing) would pass the assertion above while
    // disabling the workspace gate entirely.
    expect(matches('/test-org/hosts')).toBe(true)
    expect(matches('/')).toBe(true)
  })

  it('CONTROL — the pre-existing exclusions still hold', () => {
    // AGL-462 and the asset paths. If a careless edit to add `sw.js` widened
    // or dropped these, the failure would be a workspace-scoped API call, not
    // a broken worker.
    expect(matches('/api/auth/session')).toBe(false)
    expect(matches('/__/auth/handler')).toBe(false)
    expect(matches('/_next/static/chunk.js')).toBe(false)
    expect(matches('/_static/logo.svg')).toBe(false)
    expect(matches('/favicon.ico')).toBe(false)
  })

  it('does not exclude paths that merely CONTAIN sw.js', () => {
    // `sw.js` in the pattern is unanchored within the path segment, so a page
    // route that happens to contain it must still be gated. A workspace named
    // in a URL is attacker-influenced, so this is worth pinning.
    expect(matches('/org/sw.js.html')).toBe(true)
    expect(matches('/notsw.js')).toBe(true)
  })
})
