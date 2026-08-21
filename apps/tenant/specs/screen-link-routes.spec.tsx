/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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

/**
 * Screen links resolve against what the site SERVES (AGL-1998).
 *
 * The client renderer read `host.screens` — the map publishing writes — while
 * the router serves a corrected version of it: template screens dropped, a
 * collection's list template answered at `/{collectionSlug}`. On aglyn.com
 * that made `/blog` unreachable by any screen link at all, and made every
 * template screen offerable at a path the site 404s.
 *
 * Asserted on the PAGE rather than on the helper (that is
 * `libs/aglyn/.../screen-route.spec.ts`) because the defect was never in the
 * derivation — it was that the derivation existed only inside the loader's
 * routing decision and never reached the props the renderer reads.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// A marker rather than the real client graph: what is under test is the props
// it is HANDED, and rendering it would drag in the whole canvas.
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: function CatchAllClientMarker() {
    return null
  },
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(),
}))

import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'
import type { ReactElement } from 'react'
import CatchAllClient from '../app/[host]/[[...slug]]/catch-all-client'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock
const mockRouting = getTemplateScreenRouting as jest.Mock

/** The live aglyn.com shape: the blog's list template published at a 404. */
const PUBLISHED_MAP = {
  home: '/',
  blogListTmpl: 'blog-list-template',
  blogEntryTmpl: 'blog-entry-template',
  changelog: 'changelog',
}

/** The props the marker component was rendered with, wherever it sits. */
function propsHandedToClient(tree: unknown): Record<string, unknown> | null {
  const element = tree as ReactElement<Record<string, unknown>> | null
  if (!element || typeof element !== 'object') return null
  if ((element as { type?: unknown }).type === CatchAllClient) {
    return element.props
  }
  const children = (element.props as { children?: unknown } | undefined)
    ?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = propsHandedToClient(child)
    if (found) return found
  }
  return null
}

const renderPage = async () =>
  propsHandedToClient(
    await CatchAllPage({
      params: Promise.resolve({ host: 'acme', slug: [] }),
    } as never),
  )

describe('the routing map the renderer receives (AGL-1998)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: {
            $id: 'host-1',
            subdomain: 'acme',
            displayName: 'Acme',
            screens: PUBLISHED_MAP,
          },
          screen: { data: { $id: 'home', displayName: 'Home' } },
        },
        nodes: null,
      },
    })
    mockRouting.mockResolvedValue({
      templateScreenIds: new Set(['blogListTmpl', 'blogEntryTmpl']),
      listRoutes: { blogListTmpl: 'blog' },
    })
  })

  it('moves a list template to the collection route and drops the rest', async () => {
    const props = await renderPage()

    expect(props?.screenRoutes).toEqual({
      home: '/',
      blogListTmpl: 'blog',
      changelog: 'changelog',
    })
    // The map as PUBLISHED still travels — `host.screens` is read for the
    // canonical URL and the hreflang alternates, which are about where a
    // screen lives, not about where a link should point.
    expect((props?.data as any)?.host?.screens).toEqual(PUBLISHED_MAP)
  })

  it('does not go looking when no host resolved', async () => {
    mockLoad.mockResolvedValue({ props: { data: {}, nodes: null } })

    const props = await renderPage()

    expect(props?.screenRoutes).toBeUndefined()
    expect(mockRouting).not.toHaveBeenCalled()
  })
})
