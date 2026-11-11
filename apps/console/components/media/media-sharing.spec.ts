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
  limitAccessUsageOf,
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
  const found = (names: string[], everywhere = true) =>
    ({ state: 'checked', names, everywhere }) as const

  it('names the sites that use the file and lose it', () => {
    expect(limitAccessDescription({ usage: found(['bakery']), count: 1, allExcept: false })).toBe(
      'bakery uses this file and will stop rendering it. This does not delete anything.',
    )
  })

  /**
   * The plan's Media URLs: a bare workspace link to a file shared with all
   * sites except some keeps loading anywhere, custom HTML on a site left out
   * included. The sentence must not promise otherwise.
   */
  it('says a pasted link keeps loading under All sites except', () => {
    const text = limitAccessDescription({ usage: found(['bakery', 'florist']), count: 3, allExcept: true })
    expect(text).toContain('bakery, florist use these files')
    expect(text).toContain('pasted into custom HTML, which keeps loading')
    expect(text).not.toMatch(/will stop rendering/)
  })

  it('says it is checking while the check runs, and never that it was not checked (AGL-4047)', () => {
    const text = limitAccessDescription({ usage: { state: 'checking' }, count: 1, allExcept: false })
    expect(text).toBe('Checking which sites use this file… Any site losing access will stop rendering it.')
    expect(text).not.toMatch(/not checked/)
  })

  it('says it was not checked only when the check failed, either way', () => {
    expect(limitAccessDescription({ usage: { state: 'failed' }, count: 1, allExcept: false })).toMatch(/not checked/)
    const except = limitAccessDescription({ usage: { state: 'failed' }, count: 1, allExcept: true })
    expect(except).toMatch(/not checked/)
    expect(except).toContain('keeps loading')
  })

  it('says why too many files were not checked', () => {
    expect(
      limitAccessDescription({ usage: { state: 'tooMany', limit: 20 }, count: 25, allExcept: false }),
    ).toBe(
      'Current usage is not checked for more than 20 files at once. Any site losing access will stop rendering them.',
    )
  })

  /**
   * AGL-4047: a workspace with more sites than one scan reads got
   * "Current usage was not checked" though the scan had answered.
   */
  it('says what a check of part of the workspace found, and that it was part', () => {
    const named = limitAccessDescription({ usage: found(['bakery'], false), count: 1, allExcept: false })
    expect(named).toBe(
      'bakery uses this file and will stop rendering it. Not every site could be checked, so other ' +
        'sites may use it too. This does not delete anything.',
    )
    const none = limitAccessDescription({ usage: found([], false), count: 1, allExcept: false })
    expect(none).toMatch(/^No page checked on a site losing access uses it, but not every site could be checked\./)
    for (const text of [named, none]) expect(text).not.toMatch(/not checked/)
  })

  it('says nothing breaks when no page on a site losing access uses it', () => {
    expect(limitAccessDescription({ usage: found([]), count: 2, allExcept: true })).toBe(
      'No page on a site losing access uses them, so nothing breaks today.',
    )
  })

  it('the note under the choice says the same about custom HTML', () => {
    expect(ALL_EXCEPT_MEDIA_NOTE).toContain('custom HTML keeps loading')
  })
})

describe('limitAccessUsageOf (AGL-4047)', () => {
  const next = ['host:keeps']
  const item = (hostId: string | null, hostSubdomain = hostId) => ({ hostId, hostSubdomain })

  it('names the sites that lose a file, once each, and not the ones that keep it', () => {
    expect(
      limitAccessUsageOf(
        [
          { coverage: 'full', items: [item('loses', 'bakery'), item('keeps', 'florist'), item(null)] },
          { coverage: 'published', items: [item('loses', 'bakery')] },
        ],
        next,
      ),
    ).toEqual({ state: 'checked', names: ['bakery'], everywhere: true })
  })

  it('reads an answer that covered part of the workspace as checked, not as failed', () => {
    expect(limitAccessUsageOf([{ coverage: 'partial', items: [item('loses', 'bakery')] }], next)).toEqual({
      state: 'checked',
      names: ['bakery'],
      everywhere: false,
    })
    expect(limitAccessUsageOf([{ coverage: 'partial', items: [] }], next)).toEqual({
      state: 'checked',
      names: [],
      everywhere: false,
    })
  })

  it('keeps the answers it got when one scan of several failed', () => {
    expect(limitAccessUsageOf([{ coverage: 'full', items: [item('loses', 'bakery')] }, null], next)).toEqual({
      state: 'checked',
      names: ['bakery'],
      everywhere: false,
    })
  })

  it('is failed only when no scan answered', () => {
    expect(limitAccessUsageOf([null, null], next)).toEqual({ state: 'failed' })
  })
})
