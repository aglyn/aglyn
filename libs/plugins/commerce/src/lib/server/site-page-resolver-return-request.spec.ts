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
 * `/order-return` is the buyer's return form in the site's chrome (AGL-3611).
 *
 * The resolver runs only for an address no page of the site's own claims, so
 * what is asserted is what it composes there: the site's built-in-page layout
 * around the one return-request block, UNLISTED so it is never indexed, and
 * nothing at all for the addresses around it.
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
      throw new Error('the return page reads no documents')
    },
  },
}))

import { buildReturnRequestNodes, commerceSitePageResolver } from './site-page-resolver'

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

describe('/order-return', () => {
  it('composes the return-request block inside the site layout', async () => {
    const result = await resolve('/order-return')

    expect(mockResolveLayout).toHaveBeenCalledWith({ hostId: 'host-1', host: HOST })
    const options = mockComposeWithChrome.mock.calls[0][0]
    expect(options).toMatchObject({ hostId: 'host-1', layoutId: 'layout-1', host: HOST })
    const blocks = Object.values(options.screenNodes as Record<string, any>).filter(
      (node) => node.pluginId === 'commerce',
    )
    expect(blocks).toEqual([
      expect.objectContaining({ componentId: 'return-request', props: {} }),
    ])
    expect(result.props.nodes).toEqual({ composed: true })
    expect(result.revalidate).toBe(3600)
  })

  it('is unlisted, so it is never indexed', async () => {
    const result = await resolve('/order-return')
    expect(result.props.data.screen.data).toEqual({
      displayName: 'Request a return',
      visibility: Aglyn.HostScreenVisibility.UNLISTED,
    })
    expect(result.props.data.host).toEqual(HOST)
  })

  it('holds no order in the page', () => {
    const nodes = buildReturnRequestNodes()
    expect(JSON.stringify(nodes)).not.toMatch(/orderId|"o"|token/)
    const root = nodes[Aglyn.NODE_ROOT_ID]
    const container = nodes[String(root.nodes![0])]
    expect(container).toMatchObject({ componentId: 'muiContainer', pluginId: 'mui' })
    expect(nodes[String(container.nodes![0])]).toMatchObject({ componentId: 'return-request' })
  })

  it('falls through when the chrome cannot be composed', async () => {
    mockComposeWithChrome.mockResolvedValue(null)
    await expect(resolve('/order-return')).resolves.toBeUndefined()
  })

  it('leaves the neighboring addresses alone', async () => {
    await expect(resolve('/order-return/extra')).resolves.toBeUndefined()
    await expect(resolve('/order-returns')).resolves.toBeUndefined()
    expect(mockComposeWithChrome).not.toHaveBeenCalled()
  })
})
