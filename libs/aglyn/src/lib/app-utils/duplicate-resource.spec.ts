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
 * The duplicate catalog (AGL-2936): the names, slugs and codes every surface
 * agrees on before any document is copied.
 */

import { activityActionLabel } from './activity-presenter'
import {
  DUPLICABLE_HOST_RESOURCE_KINDS,
  DUPLICABLE_RESOURCE_KINDS,
  DUPLICATE_ACTIVITY_ACTIONS,
  DUPLICATE_COPIES,
  DUPLICATE_NAME_MAX,
  duplicateActivityActionLabel,
  duplicateDisplayName,
  duplicateVersionNote,
  isDuplicableHostResourceKind,
  isDuplicableResourceKind,
  uniqueDuplicateName,
  uniqueDuplicateSlug,
} from './duplicate-resource'

describe('the catalog', () => {
  it('names a noun, a copies sentence and an activity code for every kind', () => {
    for (const kind of DUPLICABLE_RESOURCE_KINDS) {
      expect(DUPLICATE_COPIES[kind].length).toBeGreaterThan(0)
      expect(DUPLICATE_ACTIVITY_ACTIONS[kind]).toBe(`${kind}.duplicated`)
      expect(duplicateActivityActionLabel(`${kind}.duplicated`)).toMatch(/^Duplicated a/)
    }
  })

  it('the host kinds are a subset of the kinds', () => {
    for (const kind of DUPLICABLE_HOST_RESOURCE_KINDS) {
      expect(isDuplicableResourceKind(kind)).toBe(true)
    }
    expect(isDuplicableHostResourceKind('campaign')).toBe(false)
    expect(isDuplicableHostResourceKind('theme')).toBe(false)
    expect(isDuplicableResourceKind('theme')).toBe(false)
  })

  it('the feed translates the code once, and leaves prose alone', () => {
    expect(activityActionLabel('screen.duplicated')).toBe('Duplicated a screen')
    expect(activityActionLabel('emailDesign.duplicated')).toBe(
      'Duplicated an email design',
    )
    expect(activityActionLabel('Created screen')).toBe('Created screen')
    expect(duplicateActivityActionLabel('ai.job.output')).toBeUndefined()
  })
})

describe('the default name', () => {
  it('prefixes the source name once', () => {
    expect(duplicateDisplayName('Home')).toBe('Copy of Home')
    expect(duplicateDisplayName('Copy of Home')).toBe('Copy of Home')
    expect(duplicateDisplayName('  ')).toBe('Copy of Untitled')
  })

  it('numbers a name a sibling already carries, case-insensitively', () => {
    expect(uniqueDuplicateName('Copy of Home', ['Home'])).toBe('Copy of Home')
    expect(uniqueDuplicateName('Copy of Home', ['copy of home'])).toBe(
      'Copy of Home 2',
    )
    expect(
      uniqueDuplicateName('Copy of Home', ['Copy of Home', 'Copy of Home 2']),
    ).toBe('Copy of Home 3')
  })

  it('never exceeds the field length, counter included', () => {
    const long = 'x'.repeat(DUPLICATE_NAME_MAX)
    expect(uniqueDuplicateName(long, [long])).toHaveLength(DUPLICATE_NAME_MAX)
    expect(uniqueDuplicateName(long, [long]).endsWith(' 2')).toBe(true)
  })
})

describe('the slug', () => {
  it('takes -copy, then -copy-2, and does not stack', () => {
    expect(uniqueDuplicateSlug('about', [])).toBe('about-copy')
    expect(uniqueDuplicateSlug('about', ['about-copy'])).toBe('about-copy-2')
    expect(uniqueDuplicateSlug('about-copy', ['about-copy'])).toBe('about-copy-2')
    expect(uniqueDuplicateSlug('about-copy-2', ['about-copy', 'about-copy-2'])).toBe(
      'about-copy-3',
    )
  })

  it('a source with no slug yields no slug', () => {
    expect(uniqueDuplicateSlug('', ['x'])).toBeUndefined()
    expect(uniqueDuplicateSlug(null, [])).toBeUndefined()
  })
})

describe('the version note', () => {
  it('names the source and its version count', () => {
    expect(duplicateVersionNote('Home', 3)).toBe('Duplicated from Home v3')
    expect(duplicateVersionNote('Home', null)).toBe('Duplicated from Home')
    expect(duplicateVersionNote('', 1)).toBe('Duplicated from Untitled v1')
  })
})
