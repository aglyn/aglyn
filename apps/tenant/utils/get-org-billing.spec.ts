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

const mockWithRenderCache = jest.fn(
  async (options: { read: () => Promise<unknown> }) => options.read(),
)

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: (options: never) => mockWithRenderCache(options),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: jest.fn(async () => ({ org: { plan: 'starter' } })),
}))

import getOrgBilling from './get-org-billing'

/**
 * The render's org read must not hold the page's ISR window at 60s: a
 * `withRenderCache` TTL inside a regeneration lowers the page's `revalidate`
 * to match. The request-time read (the lockdown verdict) keeps the short TTL,
 * in an entry of its own so a long render entry never answers it.
 */
describe('getOrgBilling cache scope', () => {
  beforeEach(() => mockWithRenderCache.mockClear())

  const lastOptions = () =>
    mockWithRenderCache.mock.calls.at(-1)?.[0] as unknown as {
      key: string[]
      revalidate: number
      tags: string[]
    }

  it('keeps the request-time read on the short TTL by default', async () => {
    const { org } = await getOrgBilling({ hostId: 'h1' })

    expect(org).toEqual({ plan: 'starter' })
    expect(lastOptions()).toMatchObject({
      key: ['tenant-org-billing', 'h1'],
      revalidate: 60,
      tags: ['tenant-data:h1'],
    })
  })

  it('puts the render read on the published-data backstop, keyed apart', async () => {
    await getOrgBilling({ hostId: 'h1', scope: 'render' })

    expect(lastOptions()).toMatchObject({
      key: ['tenant-org-billing-render', 'h1'],
      revalidate: 3600,
      tags: ['tenant-data:h1'],
    })
  })
})
