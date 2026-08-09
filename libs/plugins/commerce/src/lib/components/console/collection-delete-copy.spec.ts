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
 * AGL-1336: the catalog card's delete dialog must describe the REFUSAL.
 *
 * The catalog card and the Content page reach the same `/api/resources/erase`
 * route, and AGL-1324 turned that route's collection delete from a cascade
 * into a 409: a collection with remaining entries, or one a live screen binds
 * as its list/entry template, is blocked. The dialog still promised the
 * cascade — "any content entries published under it are deleted with it" —
 * which is the opposite of what happens, and the worse direction to be wrong
 * in: it reads as a warning, so an admin who wanted the entries gone would
 * confirm expecting it, and an admin who did NOT would cancel a delete that
 * was never going to touch them.
 *
 * A source guard rather than a render: the card mounts live Firestore
 * subscriptions, and the failure being pinned is the words, not the wiring.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD = join(__dirname, 'catalog-organization-card.component.tsx')
const source = readFileSync(CARD, 'utf8')

/** The `confirm({...})` call behind the collection Delete button. */
const sliceDialog = () => {
  const start = source.indexOf('handleCollectionDelete')
  if (start < 0) throw new Error('handleCollectionDelete is gone — retarget me')
  const confirmAt = source.indexOf('confirm({', start)
  if (confirmAt < 0) throw new Error('the collection delete lost its dialog')
  // Comments stripped: the prose EXPLAINING the refusal lives right beside
  // the prose SAYING it, and only the second one reaches the admin.
  return source
    .slice(confirmAt, source.indexOf('confirmationText', confirmAt))
    .replace(/^\s*\/\/.*$/gm, '')
}
const dialog = sliceDialog()

describe('catalog collection delete dialog copy (AGL-1336)', () => {
  it('no longer promises to delete the entries with the collection', () => {
    expect(dialog).not.toMatch(/deleted with it/i)
    expect(dialog).not.toMatch(/cascade/i)
  })

  it('says the delete is refused, and names both blockers', () => {
    expect(dialog).toMatch(/refused/i)
    // The two conditions `collectionDeleteDenial` blocks on (AGL-1324).
    expect(dialog).toMatch(/entries/i)
    expect(dialog).toMatch(/template/i)
  })

  it('tells the admin what to do about it', () => {
    expect(dialog).toMatch(/empty it/i)
    expect(dialog).toMatch(/detach/i)
  })

  it('leaves the route call itself alone — this was a copy fix', () => {
    expect(source).toContain("'/api/resources/erase'")
    expect(source).toContain("collectionKind: 'catalog'")
    expect(source).toContain("kind: 'collections'")
  })
})
