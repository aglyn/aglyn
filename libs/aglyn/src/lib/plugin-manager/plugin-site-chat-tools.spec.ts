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

jest.mock('./plugin-declarations-repair', () => ({ runPluginDeclarationsRepair: jest.fn(async (): Promise<void> => undefined) }))

import {
  sitePathListShows,
  normalizeSitePathList,
  normalizeSitePathPattern,
} from '../app-utils/site-path-patterns'
import { unregisterPluginServices } from './plugin-services'
import {
  listPluginSiteChatTools,
  pluginSiteChatVisitorReader,
  registerPluginSiteChatTool,
  registerPluginSiteChatVisitorReader,
  siteChatProposalRequestAllowed,
  type SiteChatTool,
} from './plugin-site-chat-tools'

const tool = (name: string, extra: Partial<SiteChatTool> = {}): SiteChatTool => ({
  name,
  description: 'd',
  inputSchema: { type: 'object', properties: {} },
  kind: 'lookup',
  capability: 'answer',
  run: async () => ({ text: '' }),
  ...extra,
})

afterEach(() => {
  unregisterPluginServices('commerce')
  unregisterPluginServices('bookings')
})

describe('core.site-chat-tools (AGL-4250)', () => {
  it('refuses a tool name that is not one word, and a proposal with no endpoints', () => {
    expect(() => registerPluginSiteChatTool(tool('Bad Name'), { pluginId: 'commerce' })).toThrow(/must match/)
    expect(() =>
      registerPluginSiteChatTool(tool('commerce_add', { kind: 'proposal', capability: 'cart' }), { pluginId: 'commerce' }),
    ).toThrow(/endpoints/)
  })

  it('lists the tools of the plugins on for the site, within what the owner allowed', async () => {
    registerPluginSiteChatTool(tool('commerce_details'), { pluginId: 'commerce' })
    registerPluginSiteChatTool(
      tool('commerce_add', { kind: 'proposal', capability: 'cart', endpoints: ['commerce/cart'] }),
      { pluginId: 'commerce' },
    )
    registerPluginSiteChatTool(
      tool('bookings_book', { kind: 'proposal', capability: 'book', endpoints: ['bookings/book'] }),
      { pluginId: 'bookings' },
    )
    const names = async (on: string[], allowed: ('answer' | 'cart' | 'book')[]) =>
      (await listPluginSiteChatTools(on, allowed)).map(({ tool: entry }) => entry.name).sort()
    expect(await names(['commerce'], ['answer'])).toEqual(['commerce_details'])
    expect(await names(['commerce', 'bookings'], ['answer', 'cart'])).toEqual(['commerce_add', 'commerce_details'])
    expect(await names(['commerce', 'bookings'], ['answer', 'cart', 'book'])).toEqual([
      'bookings_book',
      'commerce_add',
      'commerce_details',
    ])
    expect(await names([], ['answer', 'cart', 'book'])).toEqual([])
  })

  it('shows a proposal card only for a site API path its tool declared', () => {
    const declared = { endpoints: ['commerce/cart'] }
    expect(siteChatProposalRequestAllowed(declared, { path: 'commerce/cart', body: {} })).toBe(true)
    expect(siteChatProposalRequestAllowed(declared, { path: '/api/commerce/cart', body: {} })).toBe(true)
    expect(siteChatProposalRequestAllowed(declared, { path: 'commerce/cart-checkout', body: {} })).toBe(false)
    expect(siteChatProposalRequestAllowed(declared, { path: 'commerce/../admin', body: {} })).toBe(false)
    expect(siteChatProposalRequestAllowed(declared, { path: 'https://evil.example/commerce/cart', body: {} })).toBe(false)
    expect(siteChatProposalRequestAllowed(declared, undefined)).toBe(false)
  })

  it('reads the visitor through the one plugin that keeps site accounts, when it is on', async () => {
    registerPluginSiteChatVisitorReader({ readVisitor: async () => ({ name: 'Pat' }) }, { pluginId: 'commerce' })
    expect(pluginSiteChatVisitorReader(['bookings'])).toBeNull()
    expect(await pluginSiteChatVisitorReader(['commerce'])?.readVisitor({ hostId: 'h', cookies: {} })).toEqual({ name: 'Pat' })
  })
})

describe('site path lists', () => {
  it('normalizes and matches exact pages and sections', () => {
    expect(normalizeSitePathPattern('shop//*')).toBe('/shop/*')
    const list = { pages: 'only' as const, paths: ['/contact', '/shop/*'] }
    expect(sitePathListShows(list, '/shop')).toBe(true)
    expect(sitePathListShows(list, '/shop/hoodie')).toBe(true)
    expect(sitePathListShows(list, '/about')).toBe(false)
    expect(sitePathListShows({ pages: 'except', paths: ['/contact'] }, '/contact')).toBe(false)
    expect(sitePathListShows({ pages: 'except', paths: [] }, '/x', true)).toBe(false)
  })

  it('refuses a list that is not page addresses', () => {
    const options = { noun: 'the chat', maxPaths: 2, maxLength: 20 }
    expect(normalizeSitePathList({ pages: 'only', paths: [] }, options)).toEqual({ error: expect.stringMatching(/List the pages/) })
    expect(normalizeSitePathList({ pages: 'only', paths: ['/a b'] }, options)).toEqual({ error: expect.stringMatching(/not a page/) })
    expect(normalizeSitePathList({ pages: 'all', paths: ['/a'] }, options)).toEqual({ pages: 'all', paths: [] })
  })
})
