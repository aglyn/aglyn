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

import {
  isSiteRelativePath,
  registerPluginSiteOffer,
  resolvePluginSiteOffer,
  type PluginSiteOffer,
} from './plugin-site-offers'

let answer: PluginSiteOffer | null = null

beforeAll(() => {
  registerPluginSiteOffer(
    'thing',
    { resolve: async () => answer },
    { pluginId: 'store' },
  )
  registerPluginSiteOffer(
    'broken',
    { resolve: async () => Promise.reject(new Error('down')) },
    { pluginId: 'store' },
  )
})

describe('core.site-offers', () => {
  it("answers the owner's offer while it stays on the site", async () => {
    answer = {
      title: 'Pass',
      action: {
        kind: 'post',
        endpoint: '/api/store/cart',
        body: { id: 1 },
        notify: 'store:cart',
      },
    }
    expect(
      await resolvePluginSiteOffer('thing', { hostId: 'h', id: '1' }),
    ).toEqual(answer)
    answer = { title: 'Pass', action: { kind: 'link', href: '/products/pass' } }
    expect(
      await resolvePluginSiteOffer('thing', { hostId: 'h', id: '1' }),
    ).toEqual(answer)
  })

  it('refuses an action that leaves the site', async () => {
    for (const action of [
      { kind: 'link', href: 'https://elsewhere.example' },
      { kind: 'link', href: '//elsewhere.example/x' },
      { kind: 'post', endpoint: '/not-api', body: {} },
      { kind: 'post', endpoint: '/api/x', body: {}, then: 'https://x.example' },
      { kind: 'post', endpoint: '/api/x', body: {}, notify: 'has space' },
    ] as PluginSiteOffer['action'][]) {
      answer = { title: 'x', action }
      expect(
        await resolvePluginSiteOffer('thing', { hostId: 'h', id: '1' }),
      ).toBeNull()
    }
  })

  it('answers nothing for an unknown kind, a plugin switched off, or an owner that fails', async () => {
    answer = { title: 'Pass', action: { kind: 'link', href: '/p' } }
    expect(
      await resolvePluginSiteOffer('nope', { hostId: 'h', id: '1' }),
    ).toBeNull()
    expect(
      await resolvePluginSiteOffer('thing', { hostId: 'h', id: '1' }, [
        'events',
      ]),
    ).toBeNull()
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    expect(
      await resolvePluginSiteOffer('broken', { hostId: 'h', id: '1' }),
    ).toBeNull()
    error.mockRestore()
  })

  it('refuses a second plugin offering a kind another owns', () => {
    expect(() =>
      registerPluginSiteOffer(
        'thing',
        { resolve: async () => null },
        { pluginId: 'other' },
      ),
    ).toThrow(/already offered by "store"/)
  })

  it('reads site-relative paths', () => {
    expect(isSiteRelativePath('/cart')).toBe(true)
    expect(isSiteRelativePath('cart')).toBe(false)
    expect(isSiteRelativePath('/\\evil')).toBe(false)
  })
})
