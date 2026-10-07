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

import * as Aglyn from '@aglyn/aglyn/server'
import { commerceSitePageResolver } from './site-page-resolver'

/**
 * The guest order-status page (AGL-3610): served at /order-status inside the
 * site's chrome, holding the order-status block and no order, and marked
 * UNLISTED so the head says noindex.
 */
const mockChrome = jest.fn(async (options: any) => ({
  'layout-root': { $id: 'layout-root' },
  ...options.screenNodes,
}))
const mockLayout = jest.fn(async (_options: any) => 'layout-1')

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(),
  composeNodesWithChrome: (options: any) => mockChrome(options),
}))
jest.mock('@aglyn/tenant-runtime/built-in-page-layout', () => ({
  resolveBuiltInPageLayoutId: (options: any) => mockLayout(options),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('./reviews', () => ({ readProductReviews: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

const host = { $id: 'host-1', subdomain: 'northwind' }

describe('commerce page resolver: /order-status (AGL-3610)', () => {
  it('composes the order-status block into the site layout, unlisted', async () => {
    const answer: any = await commerceSitePageResolver({
      hostId: 'host-1',
      host,
      path: 'order-status',
      slugSegments: ['order-status'],
    } as never)
    expect(mockLayout).toHaveBeenCalledWith({ hostId: 'host-1', host })
    expect(mockChrome.mock.calls[0][0]).toMatchObject({ hostId: 'host-1', layoutId: 'layout-1' })
    const block = Object.values(answer.props.nodes).find(
      (node: any) => node.componentId === 'order-status',
    ) as any
    expect(block).toMatchObject({ pluginId: 'commerce', props: {} })
    const screen = answer.props.data.screen.data
    expect(screen.visibility).toBe(Aglyn.HostScreenVisibility.UNLISTED)
    expect(Aglyn.isPageIndexable({ host: {}, screen })).toBe(false)
    // No order is in the page: it is read after hydration from the signed link.
    expect(JSON.stringify(answer.props)).not.toMatch(/order-1|customerEmail/)
  })

  it('falls through when the page cannot be composed, and ignores deeper paths', async () => {
    mockChrome.mockResolvedValueOnce(null as never)
    expect(
      await commerceSitePageResolver({ hostId: 'host-1', host, path: 'order-status' } as never),
    ).toBeUndefined()
    mockChrome.mockClear()
    await commerceSitePageResolver({ hostId: 'host-1', host, path: 'order-status/x' } as never)
    expect(mockChrome).not.toHaveBeenCalled()
  })
})
