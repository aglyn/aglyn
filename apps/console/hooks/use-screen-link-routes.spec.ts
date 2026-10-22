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
import { renderHook } from '@testing-library/react'
import {
  collectCollectionTemplateRoutes,
  collectionListingTargets,
  collectionListRoutesByScreenId,
  collectionListTemplateScreenIds,
  collectionTemplateScreenIds,
} from '../constants/collection-templates'
import useScreenLinkRoutes, { screenLinkLabels } from './use-screen-link-routes'

/**
 * The real derivation, not a hand-written fake — the whole defect was two
 * surfaces answering "where is this screen served?" differently, so the test
 * that proves the picker agrees with the router must run the same collector
 * the console's Screens list does.
 */
const templatesFor = (collections: Array<Record<string, unknown>>) => ({
  templateScreenIds: collectionTemplateScreenIds(collections),
  listTemplateScreenIds: collectionListTemplateScreenIds(collections),
  routesByScreenId: collectCollectionTemplateRoutes(collections),
  listRoutesByScreenId: collectionListRoutesByScreenId(collections),
  listingTargets: collectionListingTargets(collections),
})

/** The live aglyn.com shape (AGL-1998). */
const BLOG = {
  slug: 'blog',
  listScreenId: 'blogListTmpl',
  entryScreenId: 'blogEntryTmpl',
}
const ROUTING_MAP = {
  home: '/',
  blogListTmpl: 'blog-list-template',
  blogEntryTmpl: 'blog-entry-template',
  changelog: 'changelog',
}

describe('useScreenLinkRoutes (AGL-1998)', () => {
  it('offers the blog at the path the site actually serves', () => {
    const { result } = renderHook(() =>
      useScreenLinkRoutes({
        templates: templatesFor([BLOG]),
        routingMap: ROUTING_MAP,
      }),
    )

    // The picker can point at the blog index at all, for the first time…
    expect(result.current?.blogListTmpl).toBe('blog')
    // …and neither path that 404s is offered any more.
    expect(result.current).not.toHaveProperty('blogEntryTmpl')
    expect(Object.values(result.current ?? {})).not.toContain(
      'blog-list-template',
    )
    // Ordinary screens are untouched.
    expect(result.current?.home).toBe('/')
    expect(result.current?.changelog).toBe('changelog')
  })

  it('drops a screen that says it is a template with no collection pointing at it', () => {
    // AGL-1400: clearing `entryScreenId` deliberately does not promote the
    // screen back to a page, so the pointer half cannot reach this one.
    const { result } = renderHook(() =>
      useScreenLinkRoutes({
        templates: templatesFor([]),
        routingMap: { orphanTmpl: 'orphan-template', home: '/' },
        screens: [
          { $id: 'orphanTmpl', kind: 'template' },
          { $id: 'home', kind: 'page' },
        ],
      }),
    )

    expect(result.current).toEqual({ home: '/' })
  })

  it('never routes a CATALOG collection’s list screen to /{slug}', () => {
    // `/collections/{slug}` is commerce's route and `/{slug}` is nobody's, so
    // the rewrite that saves the blog would send this one somewhere that does
    // not exist. It is dropped instead — which is exactly what the tenant
    // router does with it, since `collectTemplateScreenIds` takes every
    // `listScreenId` whatever the collection's kind.
    const { result } = renderHook(() =>
      useScreenLinkRoutes({
        templates: templatesFor([
          { slug: 'shoes', listScreenId: 'catalogTmpl', kind: 'catalog' },
        ]),
        routingMap: { catalogTmpl: 'shop-listing', home: '/' },
      }),
    )

    expect(Object.values(result.current ?? {})).not.toContain('shoes')
    expect(result.current).toEqual({ home: '/' })
  })

  it('keeps "the host has not loaded" distinct from "no screens resolve"', () => {
    const { result } = renderHook(() =>
      useScreenLinkRoutes({ templates: templatesFor([]) }),
    )

    // `ScreenLinkContext` reads undefined as "nothing has arrived yet"; `{}`
    // would render every link on the canvas dead while the host loads.
    expect(result.current).toBeUndefined()
  })
})

/**
 * Collection listings in the picker's table, and what they are called
 * (AGL-2799).
 *
 * Through the real collectors, for the reason `templatesFor` gives: the Blog
 * link in aglyn.com's drawer was a typed `/blog` because this table had no row
 * a listing could occupy.
 */
describe('useScreenLinkRoutes — collection listings (AGL-2799)', () => {
  const COLLECTIONS: Array<Record<string, unknown>> = [
    {
      $id: 'blog',
      slug: 'blog',
      displayName: 'Blog',
      listScreenId: 'blogListTmpl',
      entryScreenId: 'blogEntryTmpl',
    },
    { $id: 'yQuEudFcgR', slug: 'newsroom', displayName: 'Press' },
    { $id: 'notes', slug: 'notes' },
    { $id: 'shoes', slug: 'shoes', kind: 'catalog', displayName: 'Shoes' },
    { $id: 'drafts', displayName: 'Drafts' },
  ]

  it('offers every content collection’s listing, keyed by collection id', () => {
    const { result } = renderHook(() =>
      useScreenLinkRoutes({
        templates: templatesFor(COLLECTIONS),
        routingMap: ROUTING_MAP,
      }),
    )

    expect(result.current?.['collection:blog']).toBe('blog')
    expect(result.current?.['collection:yQuEudFcgR']).toBe('newsroom')
    // No list template required: the built-in listing is a page too.
    expect(result.current?.['collection:notes']).toBe('notes')
    // A catalog lists at `/collections/{slug}`; no slug lists nowhere.
    expect(result.current).not.toHaveProperty('collection:shoes')
    expect(result.current).not.toHaveProperty('collection:drafts')
    // And the screens are what they were.
    expect(result.current?.blogListTmpl).toBe('blog')
    expect(result.current?.home).toBe('/')
  })

  it('names each listing after its collection, under the key the table holds it by', () => {
    expect(
      screenLinkLabels(
        [
          { $id: 'home', displayName: 'Home' },
          { $id: 'blogListTmpl', displayName: 'Blog — List Template' },
        ],
        templatesFor(COLLECTIONS),
      ),
    ).toEqual({
      home: 'Home',
      blogListTmpl: 'Blog — List Template',
      'collection:blog': 'Blog',
      'collection:yQuEudFcgR': 'Press',
      // Unnamed, it is called by its slug — never by its document id.
      'collection:notes': 'notes',
    })
  })

  it('keeps working for a templates result that carries no listings', () => {
    // The shape several besigner page specs mock `useCollectionTemplates` with.
    const withoutListings = {
      templateScreenIds: new Set<string>(),
      listTemplateScreenIds: new Set<string>(),
      routesByScreenId: new Map(),
      listRoutesByScreenId: {},
    } as unknown as Parameters<typeof useScreenLinkRoutes>[0]['templates']

    const { result } = renderHook(() =>
      useScreenLinkRoutes({
        templates: withoutListings,
        routingMap: { home: '/' },
      }),
    )

    expect(result.current).toEqual({ home: '/' })
    expect(
      screenLinkLabels([{ $id: 'home', displayName: 'Home' }], {}),
    ).toEqual({ home: 'Home' })
  })
})
