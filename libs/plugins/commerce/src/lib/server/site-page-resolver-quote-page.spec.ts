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

/**
 * `/pay-quote` is the customer's quote page in the site's chrome (AGL-4094).
 *
 * The resolver runs only for an address no page of the site's own claims, so
 * what is asserted is what it composes there: the site's built-in-page layout
 * around the one quote block, UNLISTED so it is never indexed, holding no
 * quote (it is read after hydration from the link), and nothing at all for
 * the addresses around it — `/quote` included, which a business's own
 * "Request a quote" page may hold.
 */

import * as Aglyn from '@aglyn/aglyn/server'

const mockCompose = jest.fn()
const mockComposeWithChrome = jest.fn()
const mockResolveLayout = jest.fn()

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCompose(...args),
  composeNodesWithChrome: (...args: unknown[]) => mockComposeWithChrome(...args),
}))
jest.mock('@aglyn/tenant-runtime/built-in-page-layout', () => ({
  __esModule: true,
  resolveBuiltInPageLayoutId: (...args: unknown[]) => mockResolveLayout(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./reviews', () => ({ readProductReviews: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => {
      throw new Error('the quote page reads no documents')
    },
  },
}))

import { buildQuotePageNodes, commerceSitePageResolver } from './site-page-resolver'

const HOST = { $id: 'host-1', subdomain: 'acme' }

const resolve = (path: string) =>
  commerceSitePageResolver({
    hostId: 'host-1',
    host: HOST,
    path,
    slugSegments: path.split('/').filter(Boolean),
  }) as Promise<any>

beforeEach(() => {
  mockCompose.mockReset()
  mockComposeWithChrome.mockReset()
  mockResolveLayout.mockReset()
  mockResolveLayout.mockResolvedValue('layout-1')
  mockComposeWithChrome.mockResolvedValue({ composed: true })
})

describe('/pay-quote', () => {
  it('composes the quote block inside the site layout', async () => {
    const result = await resolve('/pay-quote')

    expect(mockResolveLayout).toHaveBeenCalledWith({ hostId: 'host-1', host: HOST })
    const options = mockComposeWithChrome.mock.calls[0][0]
    expect(options).toMatchObject({ hostId: 'host-1', layoutId: 'layout-1', host: HOST })
    const blocks = Object.values(options.screenNodes as Record<string, any>).filter(
      (node) => node.pluginId === 'commerce',
    )
    expect(blocks).toEqual([expect.objectContaining({ componentId: 'quote-page', props: {} })])
    expect(result.props.nodes).toEqual({ composed: true })
    expect(result.revalidate).toBe(3600)
  })

  it('is unlisted, so it is never indexed', async () => {
    const result = await resolve('/pay-quote')
    expect(result.props.data.screen.data).toEqual({
      displayName: 'Your quote',
      visibility: Aglyn.HostScreenVisibility.UNLISTED,
    })
    expect(result.props.data.host).toEqual(HOST)
  })

  it('holds no quote in the page', () => {
    const nodes = buildQuotePageNodes()
    expect(JSON.stringify(nodes)).not.toMatch(/quoteId|"q"|token/)
    const root = nodes[Aglyn.NODE_ROOT_ID]
    const container = nodes[String(root.nodes![0])]
    expect(container).toMatchObject({ componentId: 'muiContainer', pluginId: 'mui' })
    expect(nodes[String(container.nodes![0])]).toMatchObject({ componentId: 'quote-page' })
  })

  it('falls through when the chrome cannot be composed', async () => {
    mockComposeWithChrome.mockResolvedValue(null)
    await expect(resolve('/pay-quote')).resolves.toBeUndefined()
  })

  it('leaves the neighboring addresses alone, a business’s own /quote among them', async () => {
    await expect(resolve('/pay-quote/extra')).resolves.toBeUndefined()
    await expect(resolve('/quote')).resolves.toBeUndefined()
    await expect(resolve('/quotes')).resolves.toBeUndefined()
    expect(mockComposeWithChrome).not.toHaveBeenCalled()
  })
})
