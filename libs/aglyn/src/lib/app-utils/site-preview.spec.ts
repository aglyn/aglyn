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
  isHostInPreview,
  isScreenInPreview,
  isSitePreviewRequest,
  previewScreenIds,
  sitePreviewForCreate,
  sitePreviewNotice,
  sitePreviewPaths,
  sitePreviewReturnPath,
  sitePreviewStartsOn,
  sitePreviewSwitchPlan,
} from './site-preview'
import { isPageIndexable, isSearchDiscouraged, isSiteKeptFromSearch } from './search-indexing'

describe('preview state (AGL-4086)', () => {
  it('only an explicit true puts a site in preview', () => {
    expect(isHostInPreview({ preview: true })).toBe(true)
    for (const preview of [undefined, null, false, 'true' as never, 1 as never]) {
      expect(isHostInPreview({ preview })).toBe(false)
    }
    expect(isHostInPreview(null)).toBe(false)
  })

  it('reads one page in preview off the host', () => {
    const host = { previewScreens: { launch: true, draft: false } }
    expect(isScreenInPreview(host, 'launch')).toBe(true)
    expect(isScreenInPreview(host, 'draft')).toBe(false)
    expect(isScreenInPreview(host, 'other')).toBe(false)
    expect(previewScreenIds(host)).toEqual(['launch'])
  })

  it('names the request paths of the PUBLISHED pages in preview', () => {
    const host = {
      screens: { home: '/', launch: 'launch', deep: 'services/roofing/' },
      previewScreens: { home: true, deep: true, unpublished: true },
    }
    expect(sitePreviewPaths(host)).toEqual(['/', '/services/roofing'])
  })

  it('routes every path of a site in preview, and only the pages of a public one', () => {
    expect(isSitePreviewRequest({ preview: true }, '/anything')).toBe(true)
    const page = { preview: false, previewPaths: ['/launch'] }
    expect(isSitePreviewRequest(page, '/launch')).toBe(true)
    expect(isSitePreviewRequest(page, '/launch/')).toBe(true)
    expect(isSitePreviewRequest(page, '/about')).toBe(false)
    expect(isSitePreviewRequest(null, '/')).toBe(false)
  })
})

describe('a site in preview is kept from search, without flipping the search switch (AGL-4086)', () => {
  it('closes every crawler surface', () => {
    expect(isSiteKeptFromSearch({ preview: true })).toBe(true)
    expect(isPageIndexable({ host: { preview: true }, screen: {} })).toBe(false)
  })

  it('leaves the search switch reading as the author set it', () => {
    expect(isSearchDiscouraged({ preview: true })).toBe(false)
  })
})

describe('the choice at creation (AGL-4086)', () => {
  it('starts an import in preview and everything else public', () => {
    expect(sitePreviewStartsOn('import')).toBe(true)
    for (const start of ['ai', 'starter', 'blank', null, undefined]) {
      expect(sitePreviewStartsOn(start)).toBe(false)
    }
  })

  it('lets the person choose either way, whatever the start', () => {
    expect(sitePreviewForCreate({ start: 'import' })).toBe(true)
    expect(sitePreviewForCreate({ start: 'import', preview: false })).toBe(false)
    expect(sitePreviewForCreate({ start: 'starter', preview: true })).toBe(true)
    expect(sitePreviewForCreate({})).toBe(false)
    // Only a boolean is a choice; anything else falls back to the start.
    expect(sitePreviewForCreate({ start: 'import', preview: 'no' })).toBe(true)
  })
})

describe('the switch (AGL-4086)', () => {
  it('reports the first publish once, when a site that was never public goes public', () => {
    const born = { preview: true, screens: { home: '/' } }
    expect(sitePreviewSwitchPlan(born, false)).toEqual({
      preview: false,
      stampPublicSince: true,
      firstPublic: true,
      unchanged: false,
    })
    // Back into preview, and out again: it has been public, so no second report.
    const after = { preview: true, publicSinceMs: 1, screens: { home: '/' } }
    expect(sitePreviewSwitchPlan(after, false).firstPublic).toBe(false)
  })

  it('stamps a public site that goes into preview, so it never reports a first publish', () => {
    const live = { screens: { home: '/' } }
    expect(sitePreviewSwitchPlan(live, true)).toEqual({
      preview: true,
      stampPublicSince: true,
      firstPublic: false,
      unchanged: false,
    })
  })

  it('reports nothing for a site with no pages to show', () => {
    expect(sitePreviewSwitchPlan({ preview: true, screens: {} }, false).firstPublic).toBe(false)
  })

  it('knows when nothing would change', () => {
    expect(sitePreviewSwitchPlan({ preview: true }, true).unchanged).toBe(true)
    expect(sitePreviewSwitchPlan({}, false).unchanged).toBe(true)
  })
})

describe('the enter link and the notice (AGL-4086)', () => {
  it('keeps a return path on the site and refuses anything that leaves it', () => {
    expect(sitePreviewReturnPath('/menu?x=1#top')).toBe('/menu?x=1#top')
    for (const raw of ['https://evil.example', '//evil.example', '/\\evil', 'menu', '', null, '/a\nb']) {
      expect(sitePreviewReturnPath(raw)).toBe('/')
    }
  })

  it('says what the holding page says', () => {
    expect(sitePreviewNotice('Acme Bakery')).toEqual({
      title: 'Acme Bakery',
      body: 'This site is coming soon. Check back shortly.',
    })
    expect(sitePreviewNotice('  ').title).toBe('Coming soon')
  })
})
