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
 * AGL-693: the screens tree opens CLOSED.
 *
 * The table tracked a COLLAPSED set, so an empty set meant "everything is
 * open" and a nested site rendered its entire tree on arrival — the footer
 * read "1-10 of 22 top-level" while far more than ten rows were on screen.
 * Tracking the EXPANDED set makes the empty default the cheap one and the
 * count honest.
 *
 * This asserts the DECLARATION, following `screen-view-card-masonry.spec.tsx`:
 * the component needs dnd-kit, MUI and a Firestore-shaped feed to render, and
 * jsdom performs no layout, so a render test here would cost far more than it
 * proves. What can regress is someone reintroducing the inverted state — a
 * `collapsedIds` set, or an `expandedIds` seeded with anything — and that is
 * what this catches.
 *
 * It does NOT prove reads are bounded, and nothing here should be read as
 * claiming so: `screens/page.tsx` still fetches the collection with a single
 * `limit(200)`, so the children are already on the client. Closing rows by
 * default bounds what is RENDERED. Bounding reads needs root-level server
 * pagination and a per-parent child fetch, which is a separate change.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(__dirname, '..', 'components/screens-hierarchy-table.component.tsx'),
  'utf8',
)

describe('the screens tree starts collapsed (AGL-693)', () => {
  it('tracks EXPANDED ids, seeded empty', () => {
    expect(source).toMatch(
      /const \[expandedIds, setExpandedIds\] = useState<Set<ScreenUid>>\(\s*new Set\(\)\s*\)/,
    )
  })

  it('walks into a child only when it is expanded', () => {
    // The polarity is the whole fix: `!collapsedIds.has(id)` descends by
    // default, `expandedIds.has(id)` does not.
    expect(source).toMatch(/if \(hasChildren && expandedIds\.has\(child\.\$id\)\)/)
    expect(source).not.toMatch(/!collapsedIds\.has/)
  })

  it('never reintroduces a collapsed-id set', () => {
    expect(source).not.toMatch(/collapsedIds/)
  })

  it('still tells each row whether it is closed', () => {
    // The row prop stays `collapsed` — it describes the row, not the state
    // container — so it has to be derived rather than read straight off.
    expect(source).toMatch(/collapsed=\{!expandedIds\.has\(row\.\$id\)\}/)
  })
})
