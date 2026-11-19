/**
 * @jest-environment node
 *
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

import { readSiteSeoPatch, SITE_SEO_FIELDS, siteSeoChanges, siteSeoView } from './site-seo-write'

describe('readSiteSeoPatch (AGL-4235)', () => {
  it('holds each member to Setup → SEO’s limit, at the boundary', () => {
    for (const [member, field] of Object.entries(SITE_SEO_FIELDS)) {
      expect(readSiteSeoPatch({ [member]: 'a'.repeat(field.maxLength) })).toEqual({ patch: { [member]: 'a'.repeat(field.maxLength) } })
      expect(readSiteSeoPatch({ [member]: 'a'.repeat(field.maxLength + 1) })).toEqual({
        errors: { [member]: `Must be ${field.maxLength} characters or fewer` },
      })
    }
    expect(SITE_SEO_FIELDS.title.maxLength).toBe(60)
    expect(SITE_SEO_FIELDS.description.maxLength).toBe(155)
  })

  it('lets the pattern be emptied, and refuses emptying the three the card requires', () => {
    expect(readSiteSeoPatch({ titlePattern: '' })).toEqual({ patch: { titlePattern: '' } })
    expect(readSiteSeoPatch({ titlePattern: null })).toEqual({ patch: { titlePattern: '' } })
    expect(readSiteSeoPatch({ title: '', description: null, separator: '  ' })).toEqual({
      errors: {
        title: 'Required: it cannot be emptied',
        description: 'Required: it cannot be emptied',
        separator: 'Required: it cannot be emptied',
      },
    })
  })

  it('names a member it does not write', () => {
    expect(readSiteSeoPatch({ discourageSearchEngines: true, image: 'x' })).toEqual({
      errors: {
        discourageSearchEngines: 'Not writable on a site’s search listing',
        image: 'Not writable on a site’s search listing',
      },
    })
  })
})

describe('siteSeoChanges (AGL-4235)', () => {
  it('writes only what differs, and deletes an emptied pattern rather than storing it blank', () => {
    const stored = { seo: { title: 'Bakery', titlePattern: '{{page.name}}' } }
    expect(siteSeoChanges(stored, { title: 'Bakery', description: 'Fresh bread', titlePattern: '' })).toEqual([
      { path: 'seo.description', value: 'Fresh bread' },
      { path: 'seo.titlePattern', remove: true },
    ])
    expect(siteSeoChanges({}, { titlePattern: '' })).toEqual([])
  })
})

describe('siteSeoView (AGL-4235)', () => {
  it('shows the four fields and, read-only, the social image', () => {
    expect(siteSeoView('host-1', { seo: { title: 'Bakery', image: 'https://cdn.example.com/a.png', imageAlt: 'Loaves', verification: { google: 'x' } } })).toEqual({
      object: 'site_seo',
      site: 'host-1',
      title: 'Bakery',
      description: null,
      separator: null,
      titlePattern: null,
      image: 'https://cdn.example.com/a.png',
      imageAlt: 'Loaves',
    })
  })
})
