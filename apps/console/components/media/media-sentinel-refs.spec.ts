/**
 * @jest-environment node
 */

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
 * The media library must not build a Firestore ref from a SENTINEL id.
 *
 * `hostId` is optional by design here — the org library at
 * `/[orgSlug]/media` mounts the same component with no host — so a
 * `hosts/{hostId ?? '-none-'}` ref was not a loading-window race that
 * resolves on the next render. It was a read of a document that does not
 * exist, which `cloud/firebase-firestore.rules` refuses at the `hosts`
 * match (`resource.data.get('memberRoles', {})` on a missing document), on
 * every org-library mount.
 *
 * ## Why a denied ref is not "one wasted read"
 *
 * All three listener hooks — `use-firestore-doc`, `use-firestore-collection`
 * and `helpers/use-doc` — deliberately never abandon a refused listen
 * (AGL-1066): past the retry budget they reopen a genuinely fresh
 * `onSnapshot` every 2s, forever, because that loop is the only thing that
 * heals the page after an AGL-664 in-place re-auth. That is the right call
 * for a listener that is refused by accident. For one that is refused BY
 * CONSTRUCTION it means ~1,800 refusals an hour for as long as the tab is
 * open, and the UI shows nothing at all — the surrounding `assetOrigin`
 * memo discards this document unless `hostId` is truthy.
 *
 * So this is asserted statically rather than by rendering: the bug is in
 * the REF BUILDER, and a render test would need a denied-rules backend to
 * see it. Asserting at the declaration is also what keeps a future edit
 * from reintroducing the fallback (the AGL-1380 lesson — that fix repaired
 * one sentinel in `org-seller-panel` and left two `where`-clause siblings
 * thirty lines below untouched).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)

describe('media library Firestore refs (AGL-1380 shape)', () => {
  /**
   * The specific regression. `-none-` as a `hosts` document id is the exact
   * expression that shipped, and it is denied rather than merely empty.
   */
  it('never falls back to a sentinel host id', () => {
    expect(SOURCE).not.toContain("'hosts', hostId ?? '-none-'")
    expect(SOURCE).not.toContain("'hosts', hostId || '-none-'")
  })

  /**
   * The general shape, so a different sentinel spelling does not walk back
   * in. Any `hosts` ref in this file must be built from `hostId` alone.
   */
  it('builds every hosts ref from hostId with no fallback literal', () => {
    const hostRefs = [...SOURCE.matchAll(/'hosts',\s*([^)\]]+)[)\]]/g)].map(
      (match) => match[1].trim(),
    )
    // Guard against the regex silently matching nothing and passing.
    expect(hostRefs.length).toBeGreaterThan(0)
    for (const expression of hostRefs) {
      expect(expression).toBe('hostId')
    }
  })

  /**
   * The positive half: the ref builder must actually HOLD when the host is
   * unknown. `useFirestoreDoc` issues nothing for a `null` return, and that
   * null is the entire fix — without it the assertions above are satisfied
   * by a builder that simply reads `hosts/undefined`, which throws.
   */
  it('returns null from the host ref builder while hostId is unknown', () => {
    expect(SOURCE).toContain("hostId ? doc(firestore, 'hosts', hostId) : null")
  })
})
