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

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Route } from '../constants/route-links'

/**
 * Every {@link Route} must resolve to a real App Router page (AGL-685).
 *
 * The outbound sweep repointed the console's hand-built links at this table,
 * which only helps if the table itself is true. `Route.HOST_SETUP` sat in the
 * enum with no `RoutePayload` entry for months, so `buildRoute` typed its
 * payload as `any` and the theme redirect shipped `/<orgSlug?>/hosts/…` —
 * a link nothing failed on until someone clicked it.
 *
 * A unit test cannot click, but it can assert the other half: that each
 * template corresponds to a `page.tsx` on disk. A route deleted or moved
 * without updating the table fails here instead of in production.
 */

const APP_ROOT = join(__dirname, '../app')

/**
 * App Router path → filesystem path. Route groups (`(app)`, `(editor)`,
 * `(auth)`) are invisible in the URL, so each candidate segment directory is
 * searched through any group wrappers.
 */
function pageExists(template: string): boolean {
  const segments = template.split('/').filter(Boolean)

  const walk = (dir: string, rest: string[]): boolean => {
    if (!existsSync(dir)) return false
    if (rest.length === 0) {
      return (
        existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'page.ts'))
      )
    }
    const [segment, ...tail] = rest
    if (walk(join(dir, segment as string), tail)) return true
    // Descend through route groups, which do not appear in the URL.
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith('(') || !entry.endsWith(')')) continue
      const nested = join(dir, entry)
      if (!statSync(nested).isDirectory()) continue
      if (walk(nested, rest)) return true
    }
    // Last resort: a dynamic segment. Plugin-owned pages (Products, Inbox,
    // Bookings, …) have no page file of their own — they are all served by
    // `[pluginSlug]`, so matching a dynamic directory is a real resolution,
    // not a loophole. Tried last so a literal page always wins.
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith('[') || !entry.endsWith(']')) continue
      const nested = join(dir, entry)
      if (!statSync(nested).isDirectory()) continue
      if (walk(nested, tail)) return true
    }
    return false
  }

  return walk(APP_ROOT, segments)
}

describe('console route table', () => {
  it.each(Object.entries(Route))(
    'Route.%s resolves to a page file',
    (_name, template) => {
      expect({ template, exists: pageExists(template) }).toEqual({
        template,
        exists: true,
      })
    },
  )
})
