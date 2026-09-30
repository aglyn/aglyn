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
 * THE EDGE, AND THE TWO WAYS IT GOES QUIETLY WRONG.
 *
 * Both failures this module exists to stop are silent, which is why they are
 * asserted rather than reasoned about:
 *
 *  1. **Clearing the last container reads as no change.** An empty selection
 *     has to be STORED. A writer that skipped the write when nothing was
 *     picked would let a merchant take a form out of its last container, see
 *     the drawer close, and find it still filed on reload.
 *  2. **A second filing erases the first.** The field is an array precisely
 *     because a landing page outlives one push, so a helper that collapsed it
 *     to one value would un-file a record from last quarter's container with
 *     nothing on screen to say so.
 *
 * The kind here is made up: the helpers name no kind, and a plugin's own
 * spec pins the field its declared kind stores.
 */

import {
  CONTAINER_MEMBERSHIP_CAP,
  containerMembershipField,
  containerMembershipUnchanged,
  containerMembershipValue,
  contactContainerFieldPath,
  normalizeContainerIds,
  readContactContainerIds,
  readContainerIds,
} from './container-membership'
import { contactFacetPath } from './contacts'

const KIND = 'tasting'

describe('the field a member carries', () => {
  it('is the kind, pluralized as ids', () => {
    expect(containerMembershipField(KIND)).toBe('tastingIds')
    expect(containerMembershipField(' tasting ')).toBe('tastingIds')
  })

  it('refuses a membership of no kind', () => {
    // A blank kind would write a field literally named `Ids` on every record
    // it touched.
    expect(() => containerMembershipField('')).toThrow()
  })

  it('is read off a host record as a clean list', () => {
    expect(readContainerIds({ tastingIds: ['a', 'b'] }, KIND)).toEqual(['a', 'b'])
    expect(readContainerIds({}, KIND)).toEqual([])
    expect(readContainerIds(null, KIND)).toEqual([])
  })

  it('reads only the kind asked for', () => {
    const record = { tastingIds: ['a'], cellarIds: ['b'] }
    expect(readContainerIds(record, KIND)).toEqual(['a'])
    expect(readContainerIds(record, 'cellar')).toEqual(['b'])
  })
})

describe('normalizing what a writer stored', () => {
  it('drops blanks, non-strings and duplicates', () => {
    expect(
      normalizeContainerIds([' spring ', 'spring', '', null, 7, 'summer']),
    ).toEqual(['spring', 'summer'])
  })

  it('answers empty for a field no writer has ever set', () => {
    expect(normalizeContainerIds(undefined)).toEqual([])
    expect(normalizeContainerIds('spring')).toEqual([])
  })

  it('caps the array, so a runaway writer cannot grow it forever', () => {
    const many = Array.from(
      { length: CONTAINER_MEMBERSHIP_CAP + 10 },
      (_, index) => `container-${index}`,
    )
    expect(normalizeContainerIds(many)).toHaveLength(CONTAINER_MEMBERSHIP_CAP)
  })
})

describe('what a save writes', () => {
  it('STORES an empty array when every container is cleared', () => {
    /*
     * The control for failure (1). `[]` and `undefined` read the same to
     * every reader in this module, so a helper that answered `undefined`
     * would pass every read assertion above and still ship a Clear button
     * that does nothing — the caller spreads the result into an update, and
     * `undefined` is a key Firestore never writes.
     */
    const value = containerMembershipValue([])
    expect(value).toEqual([])
    expect(value).not.toBeUndefined()
  })

  it('keeps every container picked, not the last one', () => {
    // The control for failure (2).
    expect(containerMembershipValue(['spring', 'summer'])).toEqual([
      'spring',
      'summer',
    ])
  })

  it('cleans what the picker hands back', () => {
    expect(containerMembershipValue([' spring ', 'spring'])).toEqual(['spring'])
  })
})

describe('whether a save has anything to do', () => {
  it('ignores the order the two lists happen to be in', () => {
    /*
     * A picker hands back its OPTIONS' order and the document holds the order
     * it was written in, so a literal comparison would report a change on
     * every open — leaving Save permanently enabled and every page visit
     * writing.
     */
    expect(containerMembershipUnchanged(['a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('sees an addition, a removal and a clear', () => {
    expect(containerMembershipUnchanged(['a'], ['a', 'b'])).toBe(false)
    expect(containerMembershipUnchanged(['a', 'b'], ['a'])).toBe(false)
    expect(containerMembershipUnchanged(['a'], [])).toBe(false)
  })
})

describe('a contact, whose membership is one holder’s own', () => {
  it('writes inside that holder’s facet and nowhere else', () => {
    /*
     * A contact row is shared by every site in the org. What a merchant filed
     * somebody under is their business record on the same footing as their
     * notes, so the path has to name the group — a top-level field would be
     * readable by every other site in an agency's account.
     */
    expect(contactContainerFieldPath('group-a', KIND)).toBe(
      'facets.group-a.tastingIds',
    )
    expect(contactContainerFieldPath('group-a', KIND)).toBe(
      contactFacetPath('group-a', containerMembershipField(KIND)),
    )
  })

  it('reads only the asking holder’s filing', () => {
    const contact = {
      email: 'someone@example.com',
      facets: {
        'group-a': { tastingIds: ['spring'] },
        'group-b': { tastingIds: ['rival-push'] },
      },
    }
    expect(readContactContainerIds(contact, 'group-a', KIND)).toEqual(['spring'])
    // The control: a reader that fell back to the document, or to another
    // facet, would hand one business another's segmentation of a person they
    // both know.
    expect(readContactContainerIds(contact, 'group-a', KIND)).not.toContain(
      'rival-push',
    )
    expect(readContactContainerIds(contact, 'group-c', KIND)).toEqual([])
  })

  it('answers empty for a contact filed under nothing', () => {
    expect(readContactContainerIds({ email: 'a@b.co' }, 'group-a', KIND)).toEqual([])
    expect(readContactContainerIds(null, 'group-a', KIND)).toEqual([])
  })
})
