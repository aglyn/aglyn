/**
 * @jest-environment node
 */
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
import { waiversSitePageResolver } from './site-page'

/**
 * The store's own signing page (AGL-4042), at /sign-waiver on the store's
 * site, where a share link and its QR code open: the site's header and
 * footer around the Sign waiver element, holding no waiver, UNLISTED, and
 * only while Waivers is on for the site and the plan includes the store.
 */
const mockChrome = jest.fn(async (options: any) => ({ 'layout-root': { $id: 'layout-root' }, ...options.screenNodes }))
const mockLayout = jest.fn<Promise<string>, [unknown]>(async () => 'layout-1')

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(),
  composeNodesWithChrome: (options: any) => mockChrome(options),
}))
jest.mock('@aglyn/tenant-runtime/built-in-page-layout', () => ({
  resolveBuiltInPageLayoutId: (options: any) => mockLayout(options),
}))

const host = { $id: 'host-1', subdomain: 'acme' }
const org = { plan: 'starter' }
const answerFor = (context: Record<string, unknown>) =>
  waiversSitePageResolver({ hostId: 'host-1', host, org, slugSegments: [], ...context } as never)

beforeEach(() => {
  mockChrome.mockClear()
  mockLayout.mockClear()
})

describe('the waivers page resolver', () => {
  it('composes the Sign waiver element into the site layout, unlisted, with no waiver in it', async () => {
    const answer: any = await answerFor({ path: 'sign-waiver' })
    expect(mockLayout).toHaveBeenCalledWith({ hostId: 'host-1', host })
    expect(mockChrome.mock.calls[0][0]).toMatchObject({ hostId: 'host-1', layoutId: 'layout-1' })
    const element = Object.values(answer.props.nodes).find((node: any) => node.componentId === 'signWaiver') as any
    expect(element).toMatchObject({ pluginId: 'waivers', props: {} })
    const screen = answer.props.data.screen.data
    expect(screen.visibility).toBe(Aglyn.HostScreenVisibility.UNLISTED)
    expect(Aglyn.isPageIndexable({ host: {}, screen })).toBe(false)
    expect(answer.revalidate).toBe(3600)
  })

  it('also answers the path with a leading slash', async () => {
    expect(await answerFor({ path: '/sign-waiver' })).toBeDefined()
  })

  it('falls through for every other path, a site with Waivers off, and a plan without the store', async () => {
    expect(await answerFor({ path: 'sign-waiver/extra' })).toBeUndefined()
    expect(await answerFor({ path: 'waiver' })).toBeUndefined()
    expect(await answerFor({ path: 'sign-waiver', host: { ...host, disabledPlugins: ['waivers'] } })).toBeUndefined()
    expect(await answerFor({ path: 'sign-waiver', org: { plan: 'free' } })).toBeUndefined()
    expect(mockChrome).not.toHaveBeenCalled()
  })

  it('falls through when the page cannot be composed', async () => {
    mockChrome.mockResolvedValueOnce(null as never)
    expect(await answerFor({ path: 'sign-waiver' })).toBeUndefined()
  })
})
