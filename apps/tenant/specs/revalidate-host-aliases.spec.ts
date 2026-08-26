/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is undefined.
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
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': SECRET,
      },
      body: JSON.stringify(body),
    }),
  )

/**
 * The alias cache is what the middleware resolves on EVERY request, and it is
 * now held for an hour rather than 60s (AGL-1152). That trade is only safe
 * while the events that change what a name RESOLVES TO can still say so
 * out-of-band — a detach, and either rename route. These are the guard on the
 * half of that trade a comment cannot enforce: without alias-only busting a
 * disconnected domain keeps serving the host that just released it, and it
 * does so for an hour instead of a minute.
 */
describe('tenant revalidate: alias-only busting (AGL-1152)', () => {
  beforeEach(() => {
    mockRevalidatePath.mockClear()
    mockRevalidateTag.mockClear()
    process.env['REVALIDATE_SECRET'] = SECRET
  })

  it('expires a released custom domain with no paths to drop', async () => {
    const response = await call({
      host: 'demo',
      hostId: 'host-1',
      paths: [],
      aliases: ['cname--example.com'],
    })
    expect(response.status).toBe(200)
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      'tenant-host:cname--example.com',
      'max',
    )
    // The subdomain the call was addressed to is expired too, and the doc tag
    // alongside it — a detach changes the doc as well as the name.
    expect(mockRevalidateTag).toHaveBeenCalledWith('tenant-host:demo', 'max')
    expect(mockRevalidateTag).toHaveBeenCalledWith('tenant-data:host-1', 'max')
    // Nothing was asked to re-render: there are no paths in this call.
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('expires the previous label after a rename', async () => {
    await call({
      host: 'new-name',
      hostId: 'host-1',
      paths: [],
      aliases: ['old-name'],
    })
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      'tenant-host:old-name',
      'max',
    )
  })

  it('still refuses a call carrying neither paths nor aliases', async () => {
    // The guard exists to catch a caller that forgot its paths. Admitting
    // alias-only calls must not turn it into a guard that never fires.
    const response = await call({ host: 'demo', hostId: 'host-1', paths: [] })
    expect(response.status).toBe(400)
    expect(mockRevalidateTag).not.toHaveBeenCalled()
  })

  it('ignores alias entries that could name another host tree', async () => {
    await call({
      host: 'demo',
      hostId: 'host-1',
      paths: [],
      aliases: ['../other', '', '   ', 'cname--ok.com'],
    })
    const tags = mockRevalidateTag.mock.calls.map((call) => call[0])
    expect(tags).toContain('tenant-host:cname--ok.com')
    expect(tags.some((tag: string) => tag.includes('..'))).toBe(false)
  })
})
