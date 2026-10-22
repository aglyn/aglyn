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

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ORG_SLUG_PATTERN } from '@aglyn/aglyn/app-utils/organizations'
import {
  CONSOLE_TOP_LEVEL_SEGMENTS,
  isConsoleRouteSegment,
  NOT_FOUND_ROUTE,
} from '../constants/console-routes'

/**
 * The middleware answers 404 for a first path segment this set does not name
 * and no workspace claims (AGL-3017), so a route added above the org level
 * without a row here becomes unreachable — and unreachable the quiet way, as a
 * 404 that looks like a typo rather than like a missing registration.
 *
 * The list was wrong the first time it was written: `APEX_PATH_SEGMENTS` was
 * reached for as if it were the set of routes, and it omits `reset-password`
 * and `sso`. Both are credential flows. That is the mistake this spec exists
 * to make impossible to repeat.
 */
const APP_DIR = join(__dirname, '..', 'app')

/** Route groups — `(app)`, `(auth)` — are organizational and add no segment. */
const isRouteGroup = (name: string) => name.startsWith('(') && name.endsWith(')')

/** Every first URL segment the App Router actually serves a page or route at. */
function topLevelRouteSegments(dir: string): Set<string> {
  const found = new Set<string>()
  const walk = (current: string, segment: string | null) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile()) {
        if (/^(page|route)\.tsx?$/.test(entry.name) && segment) found.add(segment)
        continue
      }
      if (!entry.isDirectory()) continue
      // A group contributes nothing; anything below it is still top level.
      // Folder names are URL-decoded the way the router reads them:
      // `%5Fmissing` serves `/_missing` (AGL-3290).
      const next =
        segment ??
        (isRouteGroup(entry.name) ? null : decodeURIComponent(entry.name))
      walk(join(current, entry.name), next)
    }
  }
  walk(dir, null)
  return found
}

describe('the console top-level route set (AGL-3017)', () => {
  const actual = topLevelRouteSegments(APP_DIR)

  it('finds the routes it is supposed to be reading', () => {
    // A traversal that silently found nothing would pass every assertion below.
    expect(actual.size).toBeGreaterThan(8)
    expect(actual).toContain('signin')
  })

  it('names every top-level route the app serves', () => {
    const missing = [...actual]
      .filter((s) => s !== 'api' && !s.startsWith('[') && !s.startsWith('_'))
      .filter((s) => !CONSOLE_TOP_LEVEL_SEGMENTS.has(s))
      .sort()
    // Naming them is the whole point: a bare `toHaveLength(0)` would say a
    // number where the fix needs the word.
    expect(missing).toEqual([])
  })

  it('names nothing the app does not serve, so the set cannot rot', () => {
    const stale = [...CONSOLE_TOP_LEVEL_SEGMENTS].filter((s) => !actual.has(s)).sort()
    expect(stale).toEqual([])
  })

  it('serves the not-found page at an address no workspace can take (AGL-3290)', () => {
    // The unknown-address refusal forwards here, so the middleware must admit
    // it without asking for a verdict, and no workspace slug may shadow it.
    expect(actual).toContain(NOT_FOUND_ROUTE.slice(1))
    expect(isConsoleRouteSegment(NOT_FOUND_ROUTE.slice(1))).toBe(true)
    expect(ORG_SLUG_PATTERN.test(NOT_FOUND_ROUTE.slice(1))).toBe(false)
  })

  it('carries the two credential flows the first draft of this list omitted', () => {
    expect(CONSOLE_TOP_LEVEL_SEGMENTS.has('reset-password')).toBe(true)
    expect(CONSOLE_TOP_LEVEL_SEGMENTS.has('sso')).toBe(true)
  })
})
