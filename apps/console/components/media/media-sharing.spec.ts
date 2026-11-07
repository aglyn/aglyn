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

import {
  ALL_EXCEPT_MEDIA_NOTE,
  limitAccessDescription,
  mediaSharingChoiceOf,
  mediaSharingKey,
  mediaSharingPreview,
} from './media-sharing'

describe('mediaSharingChoiceOf (AGL-4047)', () => {
  it('reads each way a file can be shared', () => {
    expect(mediaSharingChoiceOf({ visibleTo: ['org'] })).toEqual({ mode: 'all' })
    expect(mediaSharingChoiceOf({ visibleTo: ['host:a', 'host:b'] })).toEqual({
      mode: 'selected',
      hostIds: ['a', 'b'],
    })
    expect(
      mediaSharingChoiceOf({ visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }),
    ).toEqual({ mode: 'allExcept', exceptHostIds: ['b'] })
  })

  it('reads a marked file down to no sites as the choice it is, not as never shared', () => {
    expect(mediaSharingChoiceOf({ visibleTo: [], scopeMode: 'allExcept', scopeExcept: ['host:b'] })).toEqual({
      mode: 'allExcept',
      exceptHostIds: ['b'],
    })
  })

  /** AGL-1466, AGL-1480: an absent scope is never read as All sites. */
  it('answers null where nothing is stored', () => {
    expect(mediaSharingChoiceOf({})).toBeNull()
    expect(mediaSharingChoiceOf({ visibleTo: [] })).toBeNull()
    expect(mediaSharingChoiceOf(undefined)).toBeNull()
  })
})

describe('mediaSharingKey', () => {
  it('compares choices by what they pick, in any order', () => {
    expect(mediaSharingKey({ mode: 'selected', hostIds: ['b', 'a'] })).toBe(
      mediaSharingKey({ mode: 'selected', hostIds: ['a', 'b'] }),
    )
    expect(mediaSharingKey({ mode: 'selected', hostIds: ['a'] })).not.toBe(
      mediaSharingKey({ mode: 'allExcept', exceptHostIds: ['a'] }),
    )
    expect(mediaSharingKey(null)).not.toBe(mediaSharingKey({ mode: 'all' }))
  })

  it('an untouched control equals its own document, so opening one writes nothing', () => {
    for (const doc of [{}, { visibleTo: ['org'] }, { visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }]) {
      expect(mediaSharingKey(mediaSharingChoiceOf(doc))).toBe(mediaSharingKey(mediaSharingChoiceOf({ ...doc })))
    }
  })
})

describe('mediaSharingPreview', () => {
  it('answers what the route would write', () => {
    expect(mediaSharingPreview({ mode: 'allExcept', exceptHostIds: ['b'] }, ['a', 'b', 'c'])?.fields).toEqual({
      visibleTo: ['host:a', 'host:c'],
      scopeMode: 'allExcept',
      scopeExcept: ['host:b'],
    })
  })

  it('refuses leaving every site out, and leaving none out', () => {
    expect(mediaSharingPreview({ mode: 'allExcept', exceptHostIds: ['a', 'b'] }, ['a', 'b'])?.problem).toMatch(
      /at least one site/i,
    )
    expect(mediaSharingPreview({ mode: 'allExcept', exceptHostIds: [] }, ['a', 'b'])?.problem).toMatch(/leave out/i)
  })

  it('keeps a site left out that this member can’t name, rather than taking it for gone', () => {
    expect(mediaSharingPreview({ mode: 'allExcept', exceptHostIds: ['hidden'] }, ['a'])?.fields?.scopeExcept).toEqual([
      'host:hidden',
    ])
  })

  it('is nothing when nothing is chosen', () => {
    expect(mediaSharingPreview(null, ['a'])).toBeNull()
  })
})

describe('limitAccessDescription', () => {
  it('names the sites that use the file and lose it', () => {
    expect(limitAccessDescription({ names: ['bakery'], count: 1, allExcept: false })).toBe(
      'bakery uses this file and will stop rendering it. This does not delete anything.',
    )
  })

  /**
   * The plan's Media URLs: a bare workspace link to a file shared with all
   * sites except some keeps loading anywhere, custom HTML on a site left out
   * included. The sentence must not promise otherwise.
   */
  it('for all sites except some, says a link pasted into custom HTML keeps loading', () => {
    const text = limitAccessDescription({ names: ['bakery', 'florist'], count: 3, allExcept: true })
    expect(text).toContain('bakery, florist use these files')
    expect(text).toContain('pasted into custom HTML, which keeps loading')
    expect(text).not.toMatch(/will stop rendering/)
  })

  it('says when nobody could check, either way', () => {
    expect(limitAccessDescription({ names: null, count: 1, allExcept: false })).toMatch(/not checked/)
    const except = limitAccessDescription({ names: null, count: 1, allExcept: true })
    expect(except).toMatch(/not checked/)
    expect(except).toContain('keeps loading')
  })

  it('says nothing breaks when no page there uses it', () => {
    expect(limitAccessDescription({ names: [], count: 2, allExcept: true })).toBe(
      'No page uses them yet, so nothing breaks today.',
    )
  })

  it('the note under the choice says the same about custom HTML', () => {
    expect(ALL_EXCEPT_MEDIA_NOTE).toContain('custom HTML keeps loading')
  })
})
