/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
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
 * WHICH PLUGINS MAY LOAD IS EXPIRED HARD, NOT STALE-WHILE-REVALIDATE (AGL-4121).
 *
 * Every read that decides which plugins a site loads, and every page that made
 * one, carries `tenant-plugins:{hostId}` and the platform-wide
 * `tenant-plugins`. Those caches are held for a week now, so a removal reaches
 * them only through this route — and with `'max'` the next visitor would still
 * be served the cached page, removed bundle and all, while it regenerated.
 * `{ expire: 0 }` makes that visitor wait for the fresh render instead.
 */

import {
  TENANT_PLUGINS_TAG,
  tenantPluginGateTags,
  tenantPluginsTag,
} from '@aglyn/tenant-data-admin/render-cache'

const mockRevalidatePath = jest.fn()
const mockRevalidateTag = jest.fn()
jest.mock('next/cache', () => ({
  __esModule: true,
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}))

import { POST } from '../app/api/revalidate/route'

const SECRET = 'test-revalidate-secret'

const call = async (body: unknown) =>
  POST(
    new Request('https://demo.aglyn.app/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': SECRET },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  mockRevalidatePath.mockClear()
  mockRevalidateTag.mockClear()
  process.env['REVALIDATE_SECRET'] = SECRET
})

describe('the plugin tags every plugin read carries', () => {
  it('are the site data tag, the site plugin tag and the platform plugin tag', () => {
    expect(tenantPluginGateTags('host-1')).toEqual([
      'tenant-data:host-1',
      'tenant-plugins:host-1',
      'tenant-plugins',
    ])
  })
})

describe('tenant revalidate: plugin sets (AGL-4121)', () => {
  it("hard-expires one site's plugin set for a site-scoped change", async () => {
    const response = await call({ host: 'demo', hostId: 'host-1', paths: ['/'], plugins: 'host' })
    expect(response.status).toBe(200)
    expect(mockRevalidateTag).toHaveBeenCalledWith(tenantPluginsTag('host-1'), { expire: 0 })
    expect(mockRevalidateTag).not.toHaveBeenCalledWith(TENANT_PLUGINS_TAG, expect.anything())
    await expect(response.json()).resolves.toMatchObject({
      revalidatedTags: expect.arrayContaining(['tenant-plugins:host-1']),
    })
  })

  it('hard-expires every site’s plugin set for a platform event, with no paths needed', async () => {
    const response = await call({ host: 'demo', hostId: 'host-1', paths: [], plugins: 'everywhere' })
    expect(response.status).toBe(200)
    expect(mockRevalidateTag).toHaveBeenCalledWith(TENANT_PLUGINS_TAG, { expire: 0 })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('expires no plugin tag for an ordinary publish', async () => {
    await call({ host: 'demo', hostId: 'host-1', paths: ['/'] })
    const tags = mockRevalidateTag.mock.calls.map((args) => args[0])
    expect(tags).not.toContain(TENANT_PLUGINS_TAG)
    expect(tags).not.toContain(tenantPluginsTag('host-1'))
  })

  it('reads anything but the two scopes as none, and still refuses an empty call', async () => {
    const response = await call({ host: 'demo', hostId: 'host-1', paths: [], plugins: 'all' })
    expect(response.status).toBe(400)
    expect(mockRevalidateTag).not.toHaveBeenCalled()
  })

  it('still refuses a caller without the secret', async () => {
    const response = await POST(
      new Request('https://demo.aglyn.app/api/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': 'wrong' },
        body: JSON.stringify({ host: 'demo', paths: [], plugins: 'everywhere' }),
      }),
    )
    expect(response.status).toBe(401)
    expect(mockRevalidateTag).not.toHaveBeenCalled()
  })
})
