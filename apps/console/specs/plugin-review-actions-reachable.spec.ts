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
 * AGL-2059: every review transition the route accepts has a control.
 *
 * `list` and `start-review` sat in the route's `ACTIONS` map with no caller
 * anywhere in the console. `list` is the one that turns `isListingBrowsable`
 * true — the route's own comment calls it more consequential than `verify`,
 * which has had a button all along — so the only way a listing became
 * installable by every workspace was an incidental mirror inside
 * `approve-version`, and the checklist gate the route puts on `list` had
 * never once been reachable.
 *
 * The action set is READ OUT OF THE ROUTE, not restated here. A hand-copied
 * list is exactly how two of them stayed missing: it would have been written
 * from the buttons that existed, and agreed with itself forever. Adding a
 * transition to the route now fails this until something invokes it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

const ROUTE = readFileSync(
  join(ROOT, 'app/api/admin/plugin-reviews/route.ts'),
  'utf8',
)

const DETAIL_PAGE = readFileSync(
  join(ROOT, 'app/(app)/admin/plugin-reviews/[listingId]/page.tsx'),
  'utf8',
)

/** The keys of the route's `ACTIONS` map, parsed from its source. */
function routeActions(): string[] {
  const start = ROUTE.indexOf('const ACTIONS: Record<string, string> = {')
  expect(start).toBeGreaterThan(-1)
  const end = ROUTE.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  const block = ROUTE.slice(start, end)
  const keys = Array.from(
    block.matchAll(/^\s{2}'?([a-z-]+)'?:\s*'/gm),
    (match) => match[1],
  )
  // A parser that silently matches nothing would make this whole file a
  // guard that cannot fail — the failure mode this repo has hit repeatedly.
  expect(keys.length).toBeGreaterThanOrEqual(6)
  return keys
}

describe('the plugin review queue can perform every transition', () => {
  it('parses the route action map', () => {
    expect(routeActions()).toEqual(
      expect.arrayContaining(['start-review', 'list', 'verify', 'reject']),
    )
  })

  it.each(routeActions())('the detail page invokes %s', (action) => {
    expect(DETAIL_PAGE).toContain(`action: '${action}'`)
  })

  it('listing is gated on the checklist at the button, as verify is', () => {
    // The route refuses `list` with a 409 when the checklist is outstanding.
    // A button that always posts and shows the reviewer a raw 409 is a worse
    // surface than no button; `blocked` is the page's existing name for it.
    const start = DETAIL_PAGE.indexOf(`{ action: 'list' }`)
    expect(start).toBeGreaterThan(-1)
    const region = DETAIL_PAGE.slice(Math.max(0, start - 1600), start)
    expect(region).toContain('disabled={busy || blocked}')
    expect(region).toContain('checklistOutstanding.length')
  })
})
