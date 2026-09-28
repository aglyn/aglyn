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
 * The product feed links the site's own pages (AGL-3363).
 *
 * It built every `<g:link>` from the request's `Host`, and any site's domain
 * answers `?hostId=` for any other — so a feed read through a stranger's
 * site pointed a real shop's catalog at the stranger's domain, and the CDN
 * kept that copy for an hour.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'

const mockHosts: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: (hostId: string) => ({
            get: async () => ({ exists: true, data: () => mockHosts[hostId] }),
            collection: () => ({
              limit: () => ({
                get: async () => ({
                  docs: [
                    {
                      id: 'p1',
                      data: () => ({
                        name: 'Sourdough',
                        slug: 'sourdough',
                        status: 'active',
                        variants: [{ id: 'default', priceUsd: 9, inventory: null }],
                      }),
                    },
                  ],
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { feedHandler } from './feed'

async function feed(host: string, hostId: string): Promise<string> {
  let body = ''
  const res = {
    status: () => res,
    send: (value: unknown) => {
      body = String(value)
    },
    json: () => undefined,
    setHeader: () => undefined,
  } as unknown as PluginApiResponse
  await feedHandler(
    { method: 'GET', query: { hostId }, headers: { host }, body: {} } as unknown as PluginApiRequest,
    res,
  )
  return body
}

describe('the product feed (AGL-3363)', () => {
  beforeEach(() => {
    mockHosts['bakery'] = { subdomain: 'tanyas-bakery', cname: 'tanyasbakery.com' }
  })

  it('links the shop’s own domain when read there (false-positive guard)', async () => {
    const xml = await feed('tanyasbakery.com', 'bakery')
    expect(xml).toContain('<g:link>https://tanyasbakery.com/products/sourdough</g:link>')
  })

  it('links the shop’s own domain when read through someone else’s site', async () => {
    const xml = await feed(`stranger.${TENANT_APEX}`, 'bakery')
    expect(xml).toContain('<g:link>https://tanyasbakery.com/products/sourdough</g:link>')
    expect(xml).not.toContain('stranger')
  })
})
