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

import { parseClientErrorEvents } from './client-error-report'

describe('parseClientErrorEvents (AGL-1538)', () => {
  it('parses a well-formed batch', () => {
    const events = parseClientErrorEvents({
      events: [
        {
          kind: 'error',
          message: 'boom',
          stack: 'Error: boom\n  at fn (https://app.aglyn.com/x.js:1:2)',
          url: 'https://app.aglyn.com/orgs/acme',
        },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0].message).toBe('boom')
    expect(events[0].url).toBe('https://app.aglyn.com/orgs/acme')
  })

  it('drops events without a message, and non-object entries', () => {
    const events = parseClientErrorEvents({
      events: [{ kind: 'error' }, null, 'nope', 42, { message: '' }],
    })
    expect(events).toEqual([])
  })

  it('returns [] for malformed payloads', () => {
    expect(parseClientErrorEvents(null)).toEqual([])
    expect(parseClientErrorEvents({})).toEqual([])
    expect(parseClientErrorEvents({ events: 'x' })).toEqual([])
  })

  it('caps the batch at 10 events', () => {
    const events = parseClientErrorEvents({
      events: Array.from({ length: 40 }, (_, i) => ({ message: `e${i}` })),
    })
    expect(events).toHaveLength(10)
  })

  it('clamps message and stack lengths', () => {
    const [event] = parseClientErrorEvents({
      events: [{ message: 'm'.repeat(5_000), stack: 's'.repeat(50_000) }],
    })
    expect(event.message).toHaveLength(1_024)
    expect(event.stack).toHaveLength(8_192)
  })

  it('strips query strings and fragments from urls — the PII boundary', () => {
    const [event] = parseClientErrorEvents({
      events: [
        {
          message: 'boom',
          url: 'https://app.aglyn.com/reset?token=SECRET#frag',
          source: 'https://app.aglyn.com/chunk.js?v=1',
        },
      ],
    })
    expect(event.url).toBe('https://app.aglyn.com/reset')
    expect(event.source).toBe('https://app.aglyn.com/chunk.js')
  })

  it('drops unparseable urls rather than passing them through', () => {
    const [event] = parseClientErrorEvents({
      events: [{ message: 'boom', url: 'not a url' }],
    })
    expect(event.url).toBeUndefined()
  })
})

/**
 * The heartbeat that makes beacon silence detectable (AGL-1923).
 *
 * These drive the real function against a mocked credential and a mocked
 * `fetch`, because every branch that matters is a branch of the transport:
 * the whole point of the heartbeat is that it fails in exactly the ways
 * `reportClientErrors` fails silently.
 */
describe('writeBeaconHeartbeat (AGL-1923)', () => {
  const realFetch = globalThis.fetch
  let getAccessToken: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    jest.restoreAllMocks()
  })

  async function load(app: unknown) {
    jest.doMock('firebase-admin/app', () => ({
      getApp: () => {
        if (app instanceof Error) throw app
        return app
      },
    }))
    jest.doMock('@aglyn/shared-util-fbserver', () => ({}))
    return await import('./client-error-report')
  }

  const HEALTHY_APP = {
    options: {
      projectId: 'aglyn-main',
      credential: { getAccessToken: () => getAccessToken() },
    },
  }

  it('writes ONE entry to the heartbeat log, not to client-errors', async () => {
    // If this ever regressed to `client-errors` at severity ERROR, every probe
    // would trip the `Client error beacon` alert policy — building the
    // alert-fatigue mechanism the heartbeat exists to protect against.
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const mod = await load(HEALTHY_APP)
    const result = await mod.writeBeaconHeartbeat({ service: 'console-web' })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logName).toBe(
      `projects/aglyn-main/logs/${mod.BEACON_HEARTBEAT_LOG_ID}`,
    )
    expect(body.logName).not.toContain(mod.CLIENT_ERROR_LOG_ID)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].severity).toBe('INFO')
    // No `@type`: Error Reporting ingests on it, and a heartbeat must never
    // appear as an error group.
    expect(body.entries[0].jsonPayload['@type']).toBeUndefined()
    expect(body.entries[0].jsonPayload.service).toBe('console-web')
  })

  it('mints its token through the SAME credential the reporter uses', async () => {
    // A heartbeat that authenticated some other way could report healthy while
    // every real error report was being dropped for want of a credential.
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
    const mod = await load(HEALTHY_APP)
    await mod.writeBeaconHeartbeat({ service: 'console-web' })
    expect(getAccessToken).toHaveBeenCalled()
  })

  it('reports no-credential when the token cannot be minted', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const mod = await load({ options: { projectId: 'aglyn-main', credential: undefined } })
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: false,
      code: 'no-credential',
    })
    // And it must not have attempted a write it knew would fail.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports no-credential when firebase-admin has no app at all', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const mod = await load(new Error('no app'))
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: false,
      code: 'no-credential',
    })
  })

  it('reports the STATUS on a rejected write, never the body', async () => {
    // 403 is the revoked-IAM shape; the message is dropped because the health
    // body it lands in is public and a Google error can carry resource paths.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'projects/aglyn-main/... PERMISSION_DENIED',
    }) as unknown as typeof fetch
    const mod = await load(HEALTHY_APP)
    const result = await mod.writeBeaconHeartbeat({ service: 'console-web' })
    expect(result).toEqual({ ok: false, code: 'http-403' })
    expect(JSON.stringify(result)).not.toContain('PERMISSION_DENIED')
  })

  it('reports a transport failure by NAME, and never throws', async () => {
    // The 4s abort surfaces as TimeoutError. A monitoring probe that threw
    // would be the outage it exists to report.
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    })
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(timeout) as unknown as typeof fetch
    const mod = await load(HEALTHY_APP)
    await expect(
      mod.writeBeaconHeartbeat({ service: 'console-web' }),
    ).resolves.toEqual({ ok: false, code: 'transport-TimeoutError' })
  })

  it('CLEARS: the same instance reports ok again once the write succeeds', async () => {
    // The AGL-1843 rule. Nothing here latches: there is no marker, no
    // retention window, no state carried between calls, so a recovered
    // credential is visible on the very next probe.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const mod = await load(HEALTHY_APP)
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: false,
      code: 'http-429',
    })
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: true,
    })
  })
})
