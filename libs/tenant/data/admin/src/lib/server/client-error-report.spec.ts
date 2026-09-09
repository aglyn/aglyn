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

  it('separates a missing credential from one that did not mint (AGL-2713)', async () => {
    // One of these is a deployment whose FIREBASE_* env is absent and stays
    // absent; the other is a cold lambda's first outbound TLS handshake. They
    // shared a code until AGL-2713, and the collapse is what let a warming
    // instance page an on-call human.
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    getAccessToken.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN'))
    const mod = await load(HEALTHY_APP)
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: false,
      code: 'credential-unavailable',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports credential-unavailable when the mint answers with no token', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    getAccessToken.mockResolvedValue({})
    const mod = await load(HEALTHY_APP)
    expect(await mod.writeBeaconHeartbeat({ service: 'console-web' })).toEqual({
      ok: false,
      code: 'credential-unavailable',
    })
  })

  it('keeps `beaconLoggingTarget` answering null, for the two callers that only ask that', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const mod = await load(new Error('no app'))
    expect(await mod.beaconLoggingTarget()).toBeNull()
  })
})

/**
 * ONE MISS IS NOT AN OUTAGE, TWO IS (AGL-2713).
 *
 * `/api/health/error-beacon` on the console answered `503 no-credential`
 * twice on 2026-09-09 — 15:12 and 17:22 UTC, each minutes after new capacity
 * from that day's 15:08 deploy, each self-clearing — and between them took the
 * 15-minute uptime workflow red and opened four GCP alert events. The beacon
 * was working; the beacon code path had changed by one comment line since the
 * previous release.
 *
 * These drive the shared probe both ways. The tolerating half is worth
 * nothing on its own: what makes it safe is that every permanent shape still
 * reds on the first sample, and that forgiveness needs durable proof it can
 * be spent against.
 */
describe('beaconHeartbeatProbe (AGL-2713)', () => {
  const realFetch = globalThis.fetch
  const NOW = 1_757_400_000_000
  let getAccessToken: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    jest.restoreAllMocks()
  })

  const HEALTHY_APP = {
    options: {
      projectId: 'aglyn-main',
      credential: { getAccessToken: () => getAccessToken() },
    },
  }

  async function load(app: unknown = HEALTHY_APP) {
    jest.doMock('firebase-admin/app', () => ({
      getApp: () => {
        if (app instanceof Error) throw app
        return app
      },
    }))
    jest.doMock('@aglyn/shared-util-fbserver', () => ({}))
    return await import('./client-error-report')
  }

  /** A store that answers with one landing, nothing, or a failure. */
  function fakeStore(landed: number | null | Error) {
    const set = jest.fn().mockResolvedValue(undefined)
    const get = jest.fn().mockImplementation(async () => {
      if (landed instanceof Error) throw landed
      return {
        exists: landed !== null,
        get: (field: string) =>
          landed === null || field !== 'heartbeatAtMs' ? undefined : landed,
      }
    })
    const doc = jest.fn().mockReturnValue({ set, get })
    return { set, get, doc, collection: jest.fn().mockReturnValue({ doc }) }
  }

  /** Never a real timer: the retry delay must not cost the suite 250ms. */
  const sleep = jest.fn().mockResolvedValue(undefined)

  async function probe(
    mod: Awaited<ReturnType<typeof load>>,
    store: ReturnType<typeof fakeStore>,
    graceMs = 15 * 60_000,
  ) {
    return await mod.beaconHeartbeatProbe({
      service: 'console-web',
      now: () => NOW,
      sleep,
      firestore: store,
      graceMs,
    })
  }

  it('records the landing when the heartbeat lands first time', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
    const store = fakeStore(null)
    const check = await probe(await load(), store)

    expect(check.ok).toBe(true)
    expect(check.attempts).toBe(1)
    expect(check.code).toBeUndefined()
    // The evidence a LATER miss is forgiven against. Without this write the
    // tolerance below has nothing to spend and the door reds as it does today.
    expect(store.doc).toHaveBeenCalledWith('beaconHeartbeat_console-web')
    expect(store.set.mock.calls[0][0]).toMatchObject({
      heartbeatAtMs: NOW,
      service: 'console-web',
    })
    // Not a sibling marker's field: this document must not enter another
    // probe's window and be counted as an episode it is not.
    expect(store.set.mock.calls[0][0]).not.toHaveProperty('erroredAtMs')
    expect(store.set.mock.calls[0][0].expiresAt).toBeInstanceOf(Date)
  })

  it('THE MEASURED SHAPE: a cold mint that fails once is retried and lands', async () => {
    // 15:12 and 17:22 UTC, 2026-09-09. Nothing else about the deployment was
    // wrong, and the door read 200 in 140ms minutes later.
    getAccessToken
      .mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN'))
      .mockResolvedValue({ access_token: 'tok' })
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
    const store = fakeStore(null)
    const check = await probe(await load(), store)

    expect(check.ok).toBe(true)
    expect(check.attempts).toBe(2)
    // Green, but the retry is on the board: a credential that needs two
    // attempts every time is one on its way out.
    expect(store.set).toHaveBeenCalled()
    expect(sleep).toHaveBeenCalled()
  })

  it('stays green when BOTH attempts miss and a heartbeat landed inside the grace', async () => {
    getAccessToken.mockRejectedValue(new Error('EAI_AGAIN'))
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const store = fakeStore(NOW - 60_000)
    const check = await probe(await load(), store)

    expect(check.ok).toBe(true)
    expect(check.code).toBe('heartbeat-missed')
    expect(check.attempts).toBe(2)
    expect(check.minutesSinceHeartbeat).toBe(1)
  })

  it('REDS when the silence outlasts the grace — a sustained failure still pages', async () => {
    getAccessToken.mockRejectedValue(new Error('EAI_AGAIN'))
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const store = fakeStore(NOW - 16 * 60_000)
    const check = await probe(await load(), store)

    expect(check.ok).toBe(false)
    expect(check.code).toBe('credential-unavailable')
  })

  it('REDS when the marker store cannot answer — no proof is not forgiveness', async () => {
    // The store shares the credential that is already misbehaving, so this is
    // the likely case rather than an exotic one. It must fail closed.
    getAccessToken.mockRejectedValue(new Error('EAI_AGAIN'))
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const store = fakeStore(new Error('UNAVAILABLE'))
    const check = await probe(await load(), store)

    expect(check.ok).toBe(false)
    expect(check.minutesSinceHeartbeat).toBeNull()
  })

  it('REDS on a deployment whose credential has never once worked', async () => {
    // The failure this whole change could most easily have become: excusing
    // every cold start, on a monitor that then never reds at all.
    getAccessToken.mockRejectedValue(new Error('EAI_AGAIN'))
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const check = await probe(await load(), fakeStore(null))
    expect(check.ok).toBe(false)
  })

  it('REDS a lost grant, a quota and a missing env on the FIRST sample, with no retry', async () => {
    for (const [status, code] of [
      [401, 'http-401'],
      [403, 'http-403'],
      [429, 'http-429'],
    ] as const) {
      jest.resetModules()
      getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status })
      globalThis.fetch = fetchMock as unknown as typeof fetch
      const store = fakeStore(NOW - 1_000)
      const check = await probe(await load(), store)

      expect(check.ok).toBe(false)
      expect(check.code).toBe(code)
      expect(check.attempts).toBe(1)
      // Not retried, and not forgiven against a landing one second old: these
      // stay broken until a person acts, and browser errors are being dropped
      // the entire time.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(store.get).not.toHaveBeenCalled()
    }
  })

  it('REDS a deployment with no admin app at all, whatever the marker says', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const store = fakeStore(NOW - 1_000)
    const check = await probe(await load(new Error('no app')), store)

    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-credential')
    expect(check.attempts).toBe(1)
    expect(store.get).not.toHaveBeenCalled()
  })

  it('REDS, and never throws, when the writer breaks its never-throws contract', async () => {
    // `writeBeaconHeartbeat` catches everything itself, so this branch is
    // unreachable through it — which is precisely why it needs a seam. A belt
    // nobody has watched hold is not a belt.
    const store = fakeStore(NOW - 1_000)
    const mod = await load()
    const check = await mod.beaconHeartbeatProbe({
      service: 'console-web',
      now: () => NOW,
      sleep,
      firestore: store,
      write: async () => {
        throw new Error('contract broken')
      },
    })

    expect(check.ok).toBe(false)
    // Never tolerated: a writer documented never to throw, throwing, is a bug
    // rather than a quiet network, and it is retried against nothing.
    expect(check.code).toBe('heartbeat-unavailable')
    expect(check.attempts).toBe(1)
    expect(store.get).not.toHaveBeenCalled()
  })

  it('names the log and the deployment on every outcome', async () => {
    getAccessToken.mockRejectedValue(new Error('EAI_AGAIN'))
    globalThis.fetch = jest.fn() as unknown as typeof fetch
    const mod = await load()
    const check = await probe(mod, fakeStore(NOW - 60_000))
    expect(check.logId).toBe(mod.BEACON_HEARTBEAT_LOG_ID)
    expect(check.service).toBe('console-web')
    expect(check.graceMinutes).toBe(15)
  })
})

/**
 * The server half of the beacon (AGL-1921).
 *
 * The gap this closes is not subtle: the alerting stack had eleven policies
 * and not one could see a server error rate, so a route could 500 for every
 * paying customer behind a green `/api/health`. These drive the real function
 * against a mocked credential and a mocked `fetch` — like the heartbeat
 * above, every branch that matters is a branch of the transport.
 */
/**
 * The client half's environment gate (AGL-1925).
 *
 * Driven against a mocked credential and `fetch` like the heartbeat above,
 * because the whole assertion is about whether the transport is reached.
 */
describe('reportClientErrors (AGL-1925) — a laptop is not a deployment', () => {
  const realFetch = globalThis.fetch
  const realVercel = process.env['VERCEL']
  let getAccessToken: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realVercel === undefined) delete process.env['VERCEL']
    else process.env['VERCEL'] = realVercel
    jest.restoreAllMocks()
  })

  const HEALTHY_APP = {
    options: {
      projectId: 'aglyn-main',
      credential: { getAccessToken: () => getAccessToken() },
    },
  }

  async function load() {
    jest.doMock('firebase-admin/app', () => ({ getApp: () => HEALTHY_APP }))
    jest.doMock('@aglyn/shared-util-fbserver', () => ({}))
    return await import('./client-error-report')
  }

  const okFetch = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  const EVENT = { kind: 'error', message: 'boom', url: 'http://localhost:4200/' }

  it('writes NOTHING from a developer machine', async () => {
    // Measured 2026-08-18: the top-ranked "production error group" in the whole
    // project was a dev artifact with localhost:4200 frames, and the log-match
    // policy mails Zach for every one of them.
    delete process.env['VERCEL']
    const fetchMock = okFetch()
    const mod = await load()
    const written = await mod.reportClientErrors([EVENT], { service: 'console-web' })
    expect(written).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not even MINT a token off a deployment', async () => {
    // Above the credential fetch, not below it: a dev machine holding the
    // production key should not be exercising it at all.
    delete process.env['VERCEL']
    okFetch()
    const mod = await load()
    await mod.reportClientErrors([EVENT], { service: 'console-web' })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('still reports from a deployment — the visitors this exists for', async () => {
    process.env['VERCEL'] = '1'
    const fetchMock = okFetch()
    const mod = await load()
    const written = await mod.reportClientErrors([EVENT], { service: 'tenant-web' })
    expect(written).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logName).toBe(`projects/aglyn-main/logs/${mod.CLIENT_ERROR_LOG_ID}`)
  })

  it('carries `kind` as a TOP-LEVEL field, so a policy can filter on it', async () => {
    // AGL-2523: until this, the kind reached the payload only on the stackless
    // path (folded into `message` and `reportLocation.functionName`), so every
    // stacked error — nearly all of them — was unclassifiable and the
    // `Client error beacon` policy could express nothing narrower than "any
    // entry at all".
    process.env['VERCEL'] = '1'
    const fetchMock = okFetch()
    const mod = await load()
    await mod.reportClientErrors(
      [
        {
          kind: 'hydration',
          message: 'Minified React error #418',
          stack: 'Error: x\n  at rJ (https://aglyn.com/_next/static/chunks/a.js:1:2)',
        },
      ],
      { service: 'tenant-web' },
    )
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload.kind).toBe('hydration')
    // Outside serviceContext, or Error Reporting would treat it as identity.
    expect(payload.serviceContext.kind).toBeUndefined()
    // The stack still drives grouping.
    expect(payload.message).toContain('at rJ')
  })

  it('defaults a missing kind rather than writing an unfilterable entry', async () => {
    process.env['VERCEL'] = '1'
    const fetchMock = okFetch()
    const mod = await load()
    await mod.reportClientErrors(
      [{ kind: '', message: 'boom' } as never],
      { service: 'tenant-web' },
    )
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload.kind).toBe('error')
  })

  it('still reports from a self-hosted container, which sets no VERCEL', async () => {
    delete process.env['VERCEL']
    process.env['AGLYN_STANDALONE'] = '1'
    try {
      const fetchMock = okFetch()
      const mod = await load()
      expect(
        await mod.reportClientErrors([EVENT], { service: 'tenant-web' }),
      ).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env['AGLYN_STANDALONE']
    }
  })
})

describe('reportServerError (AGL-1921)', () => {
  const realFetch = globalThis.fetch
  const realVercel = process.env['VERCEL']
  let getAccessToken: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
    // A test runner is a developer's machine, and the beacon now refuses to
    // report from one. Every case below is about what a DEPLOYMENT does, so
    // they all need to look like one; the refusal has its own describe.
    process.env['VERCEL'] = '1'
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realVercel === undefined) delete process.env['VERCEL']
    else process.env['VERCEL'] = realVercel
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

  const okFetch = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('writes to the SERVER log, not the client one — they alert separately', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)
    const outcome = await mod.reportServerError(
      { message: 'boom', route: '/[host]/[[...slug]]', method: 'GET' },
      { service: 'tenant-web' },
    )

    expect(outcome).toBe('written')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logName).toBe(`projects/aglyn-main/logs/${mod.SERVER_ERROR_LOG_ID}`)
    expect(mod.SERVER_ERROR_LOG_ID).toBe('server-errors')
    // Sharing the client log would make the existing `Client error beacon`
    // policy fire for server 5xx too, and force triage to start by asking
    // which kind it was.
    expect(body.logName).not.toContain(mod.CLIENT_ERROR_LOG_ID)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].severity).toBe('ERROR')
  })

  it('carries the ReportedErrorEvent @type, or Error Reporting never groups it', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)
    await mod.reportServerError({ message: 'boom' }, { service: 'console-web' })

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload['@type']).toBe(
      'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    )
    expect(payload.serviceContext.service).toBe('console-web')
  })

  it('sends the route PATTERN and never a resolved path — the PII boundary', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)
    await mod.reportServerError(
      {
        message: 'boom',
        route: '/[orgSlug]/hosts/[host]/settings',
        method: 'POST',
      },
      { service: 'console-web' },
    )

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload.route).toBe('/[orgSlug]/hosts/[host]/settings')
    // A resolved console path carries the org slug and document ids, and this
    // body leaves our origin for a Google log.
    const serialized = fetchMock.mock.calls[0][1].body as string
    expect(serialized).not.toContain('acme-industries')
  })

  it('stamps the environment, so a preview is separable from production', async () => {
    const realEnv = process.env['VERCEL_ENV']
    try {
      // The only reader this log can have is a hand-made log-match policy, and
      // without this field it has nothing to exclude on. The laptop half of
      // that argument is now settled by refusing to write at all — see 'a
      // laptop is not a deployment' — which leaves the preview as the case a
      // stamp still has to carry, because a preview 5xx IS reported.
      process.env['VERCEL_ENV'] = 'preview'
      const previewFetch = okFetch()
      const previewMod = await load(HEALTHY_APP)
      await previewMod.reportServerError({ message: 'boom' }, { service: 'console-web' })
      expect(
        JSON.parse(previewFetch.mock.calls[0][1].body).entries[0].jsonPayload.environment,
      ).toBe('preview')

      // Asserted in BOTH directions: a field hardcoded to either answer would
      // pass one of these and is exactly as useless as no field at all.
      jest.resetModules()
      process.env['VERCEL_ENV'] = 'production'
      const prodFetch = okFetch()
      const prodMod = await load(HEALTHY_APP)
      await prodMod.reportServerError({ message: 'boom' }, { service: 'console-web' })
      expect(
        JSON.parse(prodFetch.mock.calls[0][1].body).entries[0].jsonPayload.environment,
      ).toBe('production')
    } finally {
      if (realEnv === undefined) delete process.env['VERCEL_ENV']
      else process.env['VERCEL_ENV'] = realEnv
    }
  })

  it('uses the stack as the message when there is one', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)
    await mod.reportServerError(
      { message: 'boom', stack: 'Error: boom\n  at handler (/app/route.js:1:2)' },
      { service: 'tenant-web' },
    )

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload.message).toContain('at handler')
    // With a parseable stack, reportLocation must be absent — the stack IS
    // the grouping key.
    expect(payload.context.reportLocation).toBeUndefined()
  })

  it('falls back to reportLocation without a stack, or ingestion DROPS it', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)
    await mod.reportServerError(
      { message: 'boom', route: '/api/billing/checkout', routeType: 'route' },
      { service: 'console-web' },
    )

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].jsonPayload
    expect(payload.message).toBe('boom')
    expect(payload.context.reportLocation.filePath).toBe('/api/billing/checkout')
    expect(payload.context.reportLocation.functionName).toBe('route')
  })

  it('bounds the spike it exists to observe, and REPORTS what it suppressed', async () => {
    // The failure being watched for is a spike, and a spike is exactly when
    // an unbounded reporter turns one incident into a billing incident.
    const fetchMock = okFetch()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mod = await load(HEALTHY_APP)

    const outcomes: string[] = []
    for (let i = 0; i < 65; i += 1) {
      outcomes.push(
        await mod.reportServerError({ message: `boom ${i}` }, { service: 'tenant-web' }),
      )
    }

    expect(outcomes.filter((o) => o === 'written')).toHaveLength(60)
    expect(outcomes.filter((o) => o === 'suppressed')).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(60)

    // Suppression must never be silent: a monitoring path that hides its own
    // lossiness is the exact shape this repo keeps finding.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    await mod.reportServerError({ message: 'next window' }, { service: 'tenant-web' })
    const summary = warn.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('AGL-1921') && line.includes('suppressed'))
    expect(summary).toBeDefined()
    expect(JSON.parse(summary as string).suppressed).toBe(5)
  })

  it('drops rather than throws when the credential cannot be minted', async () => {
    okFetch()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    getAccessToken = jest.fn().mockResolvedValue({})
    const mod = await load(HEALTHY_APP)

    await expect(
      mod.reportServerError({ message: 'boom' }, { service: 'tenant-web' }),
    ).resolves.toBe('dropped')
  })

  it('never throws on a transport failure — it runs inside a failing request', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('socket hang up')) as unknown as typeof fetch
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mod = await load(HEALTHY_APP)

    await expect(
      mod.reportServerError({ message: 'boom' }, { service: 'tenant-web' }),
    ).resolves.toBe('dropped')
    expect(warn).toHaveBeenCalled()
  })

  it('reports the STATUS on a rejected write, never the body', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mod = await load(HEALTHY_APP)

    await expect(
      mod.reportServerError({ message: 'boom' }, { service: 'tenant-web' }),
    ).resolves.toBe('dropped')
    expect(String(warn.mock.calls[0][0])).toContain('403')
  })

  it('drops an empty message instead of writing a blank error group', async () => {
    const fetchMock = okFetch()
    const mod = await load(HEALTHY_APP)

    await expect(
      mod.reportServerError({ message: '' }, { service: 'tenant-web' }),
    ).resolves.toBe('dropped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /*==========================================
   * THE READABLE COUNT SURVIVES EVERY WAY THE LOGGING ARM CAN FAIL.
   *
   * `/api/health/server-errors` grades the marker, not the log — the log
   * cannot be read back at all (`403 Permission denied for all log views`,
   * measured against the production credential). So if the marker were
   * recorded only on the success path, a dead transport would present as ZERO
   * server errors, and it would present that way during precisely the incident
   * that killed the transport. The ordering is the invariant; these are the
   * tests that hold it.
   *==========================================*/
  describe('a laptop is not a deployment', () => {
    /*======================================================================
     * Measured 2026-08-31: three parse errors from an interrupted rebase, on
     * a dev server, carrying local `file:///Users/...` stacks, landed in the
     * production `server-errors` log and opened the `Server errors: uncaught
     * 5xx` policy — which was still open two days later while all thirteen
     * uptime checks read 100%. The credential comes from the root `.env`,
     * which names the platform project, so nothing about running locally
     * stopped the write.
     *====================================================================*/

    it('writes NOTHING from a developer machine', async () => {
      delete process.env['VERCEL']
      const fetchMock = okFetch()
      const mod = await load(HEALTHY_APP)
      const outcome = await mod.reportServerError(
        { message: 'Merge conflict marker encountered.' },
        { service: 'console-web' },
      )
      expect(outcome).toBe('dropped')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not COUNT it either — the health route reads that marker', async () => {
      // Above the marker, unlike every other gate: `/api/health/server-errors`
      // reads the count out of the platform project, so a counted-but-unwritten
      // laptop error would still turn that endpoint red for everyone.
      delete process.env['VERCEL']
      const recordServerError = jest.fn()
      jest.doMock('./rate-limit-store', () => ({ recordServerError }))
      okFetch()
      const mod = await load(HEALTHY_APP)
      await mod.reportServerError({ message: 'boom' }, { service: 'console-web' })
      expect(recordServerError).not.toHaveBeenCalled()
    })

    it('reports from a PREVIEW — a real deployment served that 5xx', async () => {
      // `isDeployedRuntime`, not `isProductionDeployment`: the environment
      // stamp already separates a preview for anyone who filters on it.
      process.env['VERCEL'] = '1'
      const fetchMock = okFetch()
      const mod = await load(HEALTHY_APP)
      const outcome = await mod.reportServerError(
        { message: 'boom' },
        { service: 'tenant-web' },
      )
      expect(outcome).toBe('written')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reports from a self-hosted container, which sets no VERCEL', async () => {
      delete process.env['VERCEL']
      process.env['AGLYN_STANDALONE'] = '1'
      try {
        const fetchMock = okFetch()
        const mod = await load(HEALTHY_APP)
        const outcome = await mod.reportServerError(
          { message: 'boom' },
          { service: 'tenant-web' },
        )
        expect(outcome).toBe('written')
        expect(fetchMock).toHaveBeenCalledTimes(1)
      } finally {
        delete process.env['AGLYN_STANDALONE']
      }
    })
  })

  describe('the marker is recorded above every gate', () => {
    /** Load with `recordServerError` spied, so the ORDERING is observable. */
    async function loadWithMarkerSpy(app: unknown) {
      const recordServerError = jest.fn()
      jest.doMock('./rate-limit-store', () => ({
        __esModule: true,
        recordServerError,
      }))
      const mod = await load(app)
      return { mod, recordServerError }
    }

    it('counts the error when the write SUCCEEDS', async () => {
      okFetch()
      const { mod, recordServerError } = await loadWithMarkerSpy(HEALTHY_APP)
      await mod.reportServerError({ message: 'boom' }, { service: 'console-web' })
      expect(recordServerError).toHaveBeenCalledWith('console-web')
    })

    it('counts it when there is NO CREDENTIAL to write with', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      okFetch()
      const { mod, recordServerError } = await loadWithMarkerSpy(
        new Error('no admin app'),
      )
      await expect(
        mod.reportServerError({ message: 'boom' }, { service: 'tenant-web' }),
      ).resolves.toBe('dropped')
      expect(recordServerError).toHaveBeenCalledWith('tenant-web')
    })

    it('counts it when the TRANSPORT fails', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error('socket hang up')) as unknown as typeof fetch
      const { mod, recordServerError } = await loadWithMarkerSpy(HEALTHY_APP)
      await mod.reportServerError({ message: 'boom' }, { service: 'tenant-web' })
      expect(recordServerError).toHaveBeenCalledWith('tenant-web')
    })

    it('counts it when Logging REFUSES the write', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch
      const { mod, recordServerError } = await loadWithMarkerSpy(HEALTHY_APP)
      await mod.reportServerError({ message: 'boom' }, { service: 'console-web' })
      expect(recordServerError).toHaveBeenCalledWith('console-web')
    })

    it('counts EVERY error past the Logging write budget', async () => {
      // The budget suppresses Logging writes at 60/minute/instance. A spike is
      // the event being watched for, so the COUNT must not be capped at the
      // threshold's own scale by an unrelated cost control.
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      okFetch()
      const { mod, recordServerError } = await loadWithMarkerSpy(HEALTHY_APP)
      for (let i = 0; i < 70; i += 1) {
        await mod.reportServerError({ message: `boom ${i}` }, { service: 'console-web' })
      }
      expect(recordServerError).toHaveBeenCalledTimes(70)
    })

    it('does NOT count a dropped empty message — that was never an error', async () => {
      okFetch()
      const { mod, recordServerError } = await loadWithMarkerSpy(HEALTHY_APP)
      await mod.reportServerError({ message: '' }, { service: 'console-web' })
      expect(recordServerError).not.toHaveBeenCalled()
    })
  })
})
