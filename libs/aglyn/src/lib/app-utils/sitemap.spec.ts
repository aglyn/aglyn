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
  contentSitemapSection,
  contentSitemapSectionSlug,
  parseSitemapSectionPath,
  sitemapIndexXml,
  sitemapPageCount,
  sitemapSectionPath,
  sitemapUrlsetXml,
  SITEMAP_MAX_PAGES_PER_SECTION,
  SITEMAP_URLS_PER_FILE,
} from './sitemap'

describe('sitemap addressing (AGL-2520)', () => {
  describe('section paths', () => {
    it('round-trips a section and page', () => {
      const path = sitemapSectionPath('content-blog', 3)
      expect(path).toBe('/sitemaps/content-blog/3.xml')
      expect(parseSitemapSectionPath(path)).toEqual({
        section: 'content-blog',
        page: 3,
      })
    })

    it('gives page 1 a segment of its own', () => {
      // The whole reason the page is not folded into the section name. A
      // collection slugged `blog-2` is a slug an author can create, and
      // `content-blog-2` would then mean both "page 2 of blog" and "page 1 of
      // blog-2" — an ambiguity that silently serves one collection's URLs
      // under the other's sitemap.
      expect(sitemapSectionPath('content-blog', 1)).toBe(
        '/sitemaps/content-blog/1.xml',
      )
      expect(parseSitemapSectionPath('/sitemaps/content-blog-2/1.xml')).toEqual({
        section: 'content-blog-2',
        page: 1,
      })
      expect(parseSitemapSectionPath('/sitemaps/content-blog/2.xml')).toEqual({
        section: 'content-blog',
        page: 2,
      })
    })

    it('matches nothing else the site serves', () => {
      for (const path of [
        '/sitemap.xml',
        '/sitemaps/content-blog.xml',
        '/sitemaps/content-blog/one.xml',
        '/sitemaps/content-blog/1',
        '/blog/rss.xml',
        '/api/sitemap',
      ]) {
        expect(parseSitemapSectionPath(path)).toBeUndefined()
      }
    })

    it('refuses page 0, so a section always starts at 1', () => {
      expect(parseSitemapSectionPath('/sitemaps/pages/0.xml')).toBeUndefined()
    })
  })

  describe('content sections', () => {
    it('cannot collide with a fixed section', () => {
      // A collection slugged `products` addresses `content-products`, which is
      // not the commerce section.
      expect(contentSitemapSection('products')).toBe('content-products')
      expect(contentSitemapSectionSlug('products')).toBeUndefined()
      expect(contentSitemapSectionSlug('content-products')).toBe('products')
    })

    it('cannot collide with another content section', () => {
      // The prefix is stripped exactly once, so the collection literally named
      // `content-products` stays distinct from the one named `products`.
      const nested = contentSitemapSection('content-products')
      expect(nested).toBe('content-content-products')
      expect(contentSitemapSectionSlug(nested)).toBe('content-products')
    })
  })

  describe('sitemapPageCount', () => {
    it('leaves an empty section out of the index entirely', () => {
      expect(sitemapPageCount(0)).toBe(0)
      expect(sitemapPageCount(-1)).toBe(0)
    })

    it('splits at the per-file limit', () => {
      expect(sitemapPageCount(1)).toBe(1)
      expect(sitemapPageCount(SITEMAP_URLS_PER_FILE)).toBe(1)
      expect(sitemapPageCount(SITEMAP_URLS_PER_FILE + 1)).toBe(2)
      expect(sitemapPageCount(SITEMAP_URLS_PER_FILE * 3)).toBe(3)
    })

    it('stops at the per-section ceiling', () => {
      expect(
        sitemapPageCount(SITEMAP_URLS_PER_FILE * SITEMAP_MAX_PAGES_PER_SECTION * 2),
      ).toBe(SITEMAP_MAX_PAGES_PER_SECTION)
    })
  })

  describe('documents', () => {
    it('de-duplicates urls', () => {
      // A collection slug can shadow a screen path (AGL-582); the same URL
      // twice is a duplicate submission, not a stronger signal.
      const xml = sitemapUrlsetXml([
        'https://x.test/blog',
        'https://x.test/blog',
      ])
      expect(xml.match(/<loc>/g)).toHaveLength(1)
    })

    it('escapes xml in a url', () => {
      expect(sitemapUrlsetXml(['https://x.test/a&b'])).toContain(
        '<loc>https://x.test/a&amp;b</loc>',
      )
    })

    it('names children in a sitemapindex, not a urlset', () => {
      const xml = sitemapIndexXml(['https://x.test/sitemaps/pages/1.xml'])
      expect(xml).toContain('<sitemapindex')
      expect(xml).toContain(
        '<sitemap><loc>https://x.test/sitemaps/pages/1.xml</loc></sitemap>',
      )
      expect(xml).not.toContain('<urlset')
    })
  })
})
