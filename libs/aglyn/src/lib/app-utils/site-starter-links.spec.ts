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

import { buildDefaultSiteLayout } from './default-site'
import { SITE_STARTER_LINK_SLUG_PROP, starterLinksById, starterLinksBySlug } from './site-starter-links'

const link = (id: string, props: Record<string, unknown>) => ({ id, componentId: 'muiScreenLink', props })

describe('site starter page links (AGL-4049)', () => {
  it('names the slug prop the published starter carries', () => {
    expect(SITE_STARTER_LINK_SLUG_PROP).toBe('screenSlug')
  })

  describe('starterLinksBySlug (publish side)', () => {
    it('turns a routed screenId into its slug and drops the id', () => {
      const out = starterLinksBySlug(
        { a: link('a', { children: 'About', screenId: 's_about', renderAs: 'link' }) },
        { s_home: '/', s_about: 'about' },
      )
      expect(out['a'].props).toEqual({ children: 'About', screenSlug: 'about', renderAs: 'link' })
    })

    it('leaves a screenId the routing does not name as it was', () => {
      const node = link('a', { screenId: 's_draft' })
      const out = starterLinksBySlug({ a: node }, { s_home: '/' })
      expect(out['a']).toBe(node)
    })

    it('rewrites only a string prop, one level deep in props', () => {
      const nested = { id: 'n', componentId: 'box', props: { inner: { screenId: 's_home' } } }
      const numeric = link('m', { screenId: 7 })
      const interaction = {
        id: 'i',
        componentId: 'muiButton',
        props: {},
        interactions: [{ action: 'navigate', screenId: 's_home' }],
      }
      const out = starterLinksBySlug({ n: nested, m: numeric, i: interaction }, { s_home: '/' })
      expect(out['n']).toBe(nested)
      expect(out['m']).toBe(numeric)
      expect(out['i']).toBe(interaction)
    })

    it('never reads a prototype key as a route', () => {
      const node = link('a', { screenId: 'constructor' })
      expect(starterLinksBySlug({ a: node }, {})['a']).toBe(node)
    })

    it('keeps a node without props, and does not mutate its input', () => {
      const bare = { id: 'b', componentId: 'divider' }
      const linked = link('a', { screenId: 's_home' })
      const nodes = { b: bare, a: linked }
      const out = starterLinksBySlug(nodes, { s_home: '/' })
      expect(out['b']).toBe(bare)
      expect(linked.props).toEqual({ screenId: 's_home' })
      expect(nodes).toEqual({ b: bare, a: link('a', { screenId: 's_home' }) })
    })

    it('publishes the default layout with both Home links by slug', () => {
      const { nodes } = buildDefaultSiteLayout('s_home')
      const out = starterLinksBySlug(nodes, { s_home: '/' })
      const withId = Object.values(out).filter((node: any) => node?.props?.screenId !== undefined)
      expect(withId).toEqual([])
      expect(out['dl_brand'].props.screenSlug).toBe('/')
      expect(out['dl_footerHome'].props.screenSlug).toBe('/')
      // A plain href link is not a page link.
      expect(out['dl_footerSearch']).toBe(nodes['dl_footerSearch'])
    })
  })

  describe('starterLinksById (install side)', () => {
    it('turns a slug into the new page id and drops the slug', () => {
      const out = starterLinksById(
        { a: link('a', { children: 'About', screenSlug: 'about' }) },
        { '/': 'n_home', about: 'n_about' },
      )
      expect(out['a'].props).toEqual({ children: 'About', screenId: 'n_about' })
    })

    it('drops a slug no page has, leaving no link prop at all', () => {
      const out = starterLinksById({ a: link('a', { children: 'Gone', screenSlug: 'gone' }) }, { '/': 'n_home' })
      expect(out['a'].props).toEqual({ children: 'Gone' })
    })

    it('leaves a node with no slug prop as it was', () => {
      const node = link('a', { href: '/search' })
      expect(starterLinksById({ a: node }, { '/': 'n_home' })['a']).toBe(node)
    })

    it('round-trips the default layout onto a new Home id', () => {
      const { nodes } = buildDefaultSiteLayout('s_home')
      const installed = starterLinksById(starterLinksBySlug(nodes, { s_home: '/' }), { '/': 'n_home' })
      expect(installed['dl_brand'].props.screenId).toBe('n_home')
      expect(installed['dl_footerHome'].props.screenId).toBe('n_home')
      const slugs = Object.values(installed).filter((node: any) => node?.props?.screenSlug !== undefined)
      expect(slugs).toEqual([])
      expect(installed).toEqual(buildDefaultSiteLayout('n_home').nodes)
    })
  })
})
