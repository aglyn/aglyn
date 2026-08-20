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
  collectionListRoutesByScreenId,
  collectionListTemplateScreenIds,
  collectionTemplateScreenIds,
} from '../constants/collection-templates'
import useScreenLinkRoutes from './use-screen-link-routes'

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
