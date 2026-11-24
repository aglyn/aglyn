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
  homeScreenIdOf,
  newPageLayoutId,
  screenLayoutBinding,
} from './new-page-layout'

describe('newPageLayoutId (AGL-4241)', () => {
  const header = { id: 'lay-header' }
  const plain = { id: 'lay-plain' }

  it('uses the layout a new site binds its Home page to', () => {
    expect(newPageLayoutId({ homeLayoutId: 'lay-header', layouts: [header, plain] })).toBe('lay-header')
  })

  it('prefers the Built-in page layout setting over the home page', () => {
    expect(
      newPageLayoutId({ designatedLayoutId: 'lay-plain', homeLayoutId: 'lay-header', layouts: [header, plain] }),
    ).toBe('lay-plain')
  })

  it('skips a designated or home layout that was deleted or is not on the site', () => {
    expect(
      newPageLayoutId({
        designatedLayoutId: 'gone',
        homeLayoutId: 'lay-plain',
        layouts: [header, { id: 'lay-plain', deletedAt: 1 }, { id: 'lay-third' }],
      }),
    ).toBeUndefined()
  })

  it('falls back to the site’s only layout when nothing names one', () => {
    expect(newPageLayoutId({ homeLayoutId: null, layouts: [header, { id: 'old', deletedAt: 1 }] })).toBe('lay-header')
  })

  it('never guesses among several layouts', () => {
    expect(newPageLayoutId({ layouts: [header, plain] })).toBeUndefined()
  })

  it('binds nothing on a site with no layout', () => {
    expect(newPageLayoutId({ designatedLayoutId: 'lay-header', homeLayoutId: 'lay-header', layouts: [] })).toBeUndefined()
    expect(newPageLayoutId({ layouts: undefined })).toBeUndefined()
  })
})

describe('screenLayoutBinding', () => {
  it('reads the version first, and honours an explicit null there', () => {
    expect(screenLayoutBinding({ layoutId: 'a' }, { layoutId: 'b' })).toBe('b')
    expect(screenLayoutBinding({ layoutId: 'a' }, { layoutId: null })).toBeNull()
  })

  it('falls back to the screen when the version carries no key', () => {
    expect(screenLayoutBinding({ layoutId: 'a' }, {})).toBe('a')
    expect(screenLayoutBinding({ layoutId: 'a' }, undefined)).toBe('a')
    expect(screenLayoutBinding({}, undefined)).toBeNull()
  })
})

describe('homeScreenIdOf', () => {
  it('finds the page routed at the site root', () => {
    expect(homeScreenIdOf({ s1: 'about', s2: '/' })).toBe('s2')
    expect(homeScreenIdOf({ s1: 'about' })).toBeUndefined()
    expect(homeScreenIdOf(undefined)).toBeUndefined()
  })
})
