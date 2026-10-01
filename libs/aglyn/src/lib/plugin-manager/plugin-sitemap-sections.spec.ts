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
  contentSitemapSectionSlug,
  parseSitemapSectionPath,
  SITEMAP_SECTION_AUTHORS,
  SITEMAP_SECTION_PAGES,
  sitemapSectionPath,
} from '../app-utils/sitemap'
import { listPluginHostCollections } from './plugin-host-collections'
import {
  listPluginSitemapSections,
  pluginSitemapSection,
  pluginSitemapSectionPath,
} from './plugin-sitemap-sections'

/**
 * The child sitemaps plugins declare (AGL-3080), read with no plugin loaded —
 * the state the tenant's `/sitemap.xml` is in. A declaration that went missing
 * would drop its pages from every live site's index with nothing red, so the
 * floor is asserted here and the tenant's `sitemap-index.spec.ts` exercises
 * the declared sections end to end.
 */
describe('declared sitemap sections', () => {
  it('declares at least one, or a lost declaration is invisible', () => {
    expect(listPluginSitemapSections().length).toBeGreaterThan(0)
  })

  it('never shadows a section the platform builds', () => {
    for (const declared of listPluginSitemapSections()) {
      expect([SITEMAP_SECTION_PAGES, SITEMAP_SECTION_AUTHORS]).not.toContain(declared.section)
      expect(contentSitemapSectionSlug(declared.section)).toBeUndefined()
    }
  })

  it('round-trips through the path the index writes and the middleware parses', () => {
    for (const declared of listPluginSitemapSections()) {
      expect(parseSitemapSectionPath(sitemapSectionPath(declared.section, 2))).toEqual({
        section: declared.section,
        page: 2,
      })
      expect(pluginSitemapSection(declared.section)).toBe(declared)
    }
  })

  it('reads a settings document its own plugin owns', () => {
    for (const declared of listPluginSitemapSections()) {
      if (!declared.enabledBy) continue
      const [collection] = declared.enabledBy.doc.split('/')
      const owner = listPluginHostCollections().find((one) => one.name === collection)
      expect([declared.section, owner?.pluginId]).toEqual([declared.section, declared.pluginId])
    }
  })
})

describe('a declared section’s address', () => {
  const declared = { section: 'bottles', collection: 'bottles', path: '/cellar/{slug}' }

  it('puts the slug where the declaration says', () => {
    expect(pluginSitemapSectionPath(declared, 'merlot-2019')).toBe('/cellar/merlot-2019')
  })

  it('is nothing for a row with no slug, which addresses no page', () => {
    for (const slug of ['', undefined, null, 7]) {
      expect(pluginSitemapSectionPath(declared, slug)).toBeNull()
    }
  })

  it('is no section for a name nobody declared', () => {
    expect(pluginSitemapSection('nonesuch')).toBeNull()
  })
})
