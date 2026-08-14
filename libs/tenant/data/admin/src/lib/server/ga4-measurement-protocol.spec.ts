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
 * AGL-1589 — the server-side `site_published` sender.
 *
 * Two properties are worth pinning. The first is that ABSENT CONFIG IS NOT AN
 * ERROR: `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` exist only in the console's
 * environment today, and this code runs in the tenant app — so the normal
 * state, right now and on every self-hosted deployment, is a clean no-op. The
 * second is that one host is one synthetic GA user, however many of its
 * screens go live on a timer; a random client id per publish would inflate
 * the activation metric, which is the exact failure the event is meant to
 * measure away from.
 */

import { sendGa4SitePublished, synthesizeClientId } from './ga4-measurement-protocol'

const originalEnv = { ...process.env }
const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as never)

beforeEach(() => {
  fetchMock.mockClear()
  global.fetch = fetchMock as never
  delete process.env.GA4_MEASUREMENT_ID
  delete process.env.GA4_API_SECRET
})

afterAll(() => {
  process.env = { ...originalEnv }
})

describe('sendGa4SitePublished with no Measurement Protocol config', () => {
  it('no-ops cleanly rather than throwing or logging', async () => {
    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result).toEqual({
      sent: false,
      synthesizedClientId: false,
      reason: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sendGa4SitePublished when configured', () => {
  beforeEach(() => {
    process.env.GA4_MEASUREMENT_ID = 'G-TEST'
    process.env.GA4_API_SECRET = 'secret'
  })

  it('sends site_published with a client id derived from the host', async () => {
    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result.sent).toBe(true)
    expect(result.synthesizedClientId).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ]
    expect(url).toContain('measurement_id=G-TEST')
    const body = JSON.parse(init.body)
    expect(body.events).toEqual([{ name: 'site_published', params: {} }])
    expect(body.client_id).toBe(synthesizeClientId('host-1'))
    // AGL-1538 posture, asserted per hit rather than trusted to the property.
    expect(body.non_personalized_ads).toBe(true)
  })

  it('sends the host id ONLY as a hash — never as a param or a user id', async () => {
    await sendGa4SitePublished({ hostId: 'host-1' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ]
    expect(init.body).not.toContain('host-1')
    expect(JSON.parse(init.body).user_id).toBeUndefined()
  })

  it('maps one host to one GA user across repeated publishes', async () => {
    await sendGa4SitePublished({ hostId: 'host-1' })
    await sendGa4SitePublished({ hostId: 'host-1' })

    const clientIds = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, { body: string }])[1].body).client_id,
    )
    expect(clientIds[0]).toBe(clientIds[1])
    expect(clientIds[0]).not.toBe(synthesizeClientId('host-2'))
  })

  it('never throws when the network does', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline') as never)

    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result).toEqual({
      sent: false,
      synthesizedClientId: true,
      reason: 'network',
    })
  })
})
