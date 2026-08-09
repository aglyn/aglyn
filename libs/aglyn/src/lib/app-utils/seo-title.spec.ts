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

import { resolveSeoTitle } from './seo-title'

/** The marketing host, whose separator really is a bare, unpadded `-`. */
const SITE = { siteTitle: 'Acme Widgets', separator: '-', fallback: 'Acme site' }

describe('the page title (AGL-1341)', () => {
  describe('an authored title wins verbatim', () => {
    it('appends nothing at all', () => {
      // The bug, exactly: this used to render
      // "About Aglyn — one platform for the open web-Website Builder - …",
      // 94 characters against a budget of about 60.
      expect(
        resolveSeoTitle({
          title: 'About Aglyn — one platform for the open web',
          name: 'About',
          ...SITE,
        }),
      ).toBe('About Aglyn — one platform for the open web')
    })

    it('beats the page name as well as the site title', () => {
      expect(resolveSeoTitle({ title: 'Pricing that scales', name: 'Pricing', ...SITE })).toBe(
        'Pricing that scales',
      )
    })

    it('trims, because a stray space is not part of the title', () => {
      expect(resolveSeoTitle({ title: '  Contact us  ', ...SITE })).toBe('Contact us')
    })
  })

  describe('no authored title: the site title is the fallback', () => {
    it('joins the page name to the site title', () => {
      expect(resolveSeoTitle({ name: 'Contact', ...SITE })).toBe('Contact - Acme Widgets')
    })

    it('pads a bare separator, so two titles do not run into one word', () => {
      // `…open web-Website Builder…` is what an unpadded join looked like on
      // the live site. The field caps at 3 characters and people type `-`.
      expect(resolveSeoTitle({ name: 'Contact', ...SITE })).not.toContain('Contact-')
    })

    it('defaults the separator when the host set none', () => {
      expect(resolveSeoTitle({ name: 'Contact', siteTitle: 'Acme Widgets' })).toBe(
        'Contact – Acme Widgets',
      )
    })

    it('keeps a separator the host typed with its own spacing intent', () => {
      expect(
        resolveSeoTitle({ name: 'Contact', siteTitle: 'Acme Widgets', separator: '|' }),
      ).toBe('Contact | Acme Widgets')
    })
  })

  describe('the separator only appears with both sides', () => {
    it('renders the site title alone for a page with no name', () => {
      expect(resolveSeoTitle({ ...SITE, name: '' })).toBe('Acme Widgets')
    })

    it('renders the name alone for a site that named itself nothing', () => {
      expect(resolveSeoTitle({ name: 'Contact', separator: '-' })).toBe('Contact')
    })

    it('never emits a leading or trailing separator', () => {
      const bare = resolveSeoTitle({ ...SITE, name: undefined })
      expect(bare.startsWith('-')).toBe(false)
      expect(bare.trim()).toBe(bare)
    })
  })

  describe('empty and whitespace are ABSENT, not set', () => {
    it('treats a cleared title as no title', () => {
      // `''` is what the console writes for a cleared field (AGL-1191).
      expect(resolveSeoTitle({ title: '', name: 'Contact', ...SITE })).toBe(
        'Contact - Acme Widgets',
      )
    })

    it('treats a whitespace-only title as no title', () => {
      expect(resolveSeoTitle({ title: '   ', name: 'Contact', ...SITE })).toBe(
        'Contact - Acme Widgets',
      )
    })

    it('treats a whitespace-only site title as no site title', () => {
      expect(resolveSeoTitle({ name: 'Contact', siteTitle: '  ', separator: '-' })).toBe(
        'Contact',
      )
    })

    it('falls back rather than rendering an empty tag', () => {
      expect(resolveSeoTitle({ fallback: 'Acme site' })).toBe('Acme site')
      expect(resolveSeoTitle({ title: ' ', name: ' ', siteTitle: ' ', fallback: 'Acme site' })).toBe(
        'Acme site',
      )
    })

    it('returns an empty string only when the caller offered nothing', () => {
      expect(resolveSeoTitle({})).toBe('')
    })
  })
})
