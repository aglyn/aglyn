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
 * Guards for the Vercel log-drain receiver (AGL-1921, third arm).
 *
 * Every one of these is a guard against a specific way this arm turns from a
 * monitor into a liability: an open endpoint, a Logging bill, a feedback
 * loop, a silent drop.
 */
import {
  drainSignatureFor,
  isValidDrainSignature,
} from './vercel-drain-signature'

const SECRET = 'drain-secret-value'

describe('isValidDrainSignature (AGL-1921) — fails closed', () => {
  const body = '[{"id":"1","statusCode":500}]'

  it('accepts the signature Vercel would actually send', () => {
    expect(
      isValidDrainSignature(body, drainSignatureFor(body, SECRET), SECRET),
    ).toBe(true)
  })

  it('rejects a WRONG signature', () => {
    expect(
      isValidDrainSignature(body, drainSignatureFor(body, 'other'), SECRET),
    ).toBe(false)
  })

  it('rejects a MISSING signature header', () => {
    expect(isValidDrainSignature(body, null, SECRET)).toBe(false)
    expect(isValidDrainSignature(body, '', SECRET)).toBe(false)
  })

  it('rejects everything when NO secret is configured', () => {
    // The unset-env case. An endpoint that accepted anything because it was
    // misconfigured would be worse than one that rejected everything.
    expect(
      isValidDrainSignature(body, drainSignatureFor(body, SECRET), undefined),
    ).toBe(false)
    expect(
      isValidDrainSignature(body, drainSignatureFor(body, SECRET), ''),
    ).toBe(false)
  })

  it('rejects a signature of a DIFFERENT body', () => {
    // i.e. the header is bound to the bytes, not merely present.
    expect(
      isValidDrainSignature(
        body,
        drainSignatureFor('[{"id":"1","statusCode":200}]', SECRET),
        SECRET,
      ),
    ).toBe(false)
  })

  it('rejects a short or long digest without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch; a 500 here would be both
    // an outage and a length oracle.
    expect(() => isValidDrainSignature(body, 'abc', SECRET)).not.toThrow()
    expect(isValidDrainSignature(body, 'abc', SECRET)).toBe(false)
    expect(isValidDrainSignature(body, 'f'.repeat(80), SECRET)).toBe(false)
  })

  it('signs the RAW bytes — a re-serialized body does not verify', () => {
    // The trap the docs warn about: parse-then-stringify changes whitespace,
    // and the failure then looks like a wrong secret rather than a bug.
    const raw = '[ {"id":"1", "statusCode":500} ]'
    const reserialized = JSON.stringify(JSON.parse(raw))
    expect(raw).not.toBe(reserialized)
    expect(
      isValidDrainSignature(
        raw,
        drainSignatureFor(reserialized, SECRET),
        SECRET,
      ),
    ).toBe(false)
  })
})

describe('the drain receiver ingest path (AGL-1921)', () => {
  const realFetch = globalThis.fetch
  let getAccessToken: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    getAccessToken = jest.fn().mockResolvedValue({ access_token: 'tok' })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
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

  async function load() {
    jest.doMock('firebase-admin/app', () => ({ getApp: () => HEALTHY_APP }))
    jest.doMock('@aglyn/shared-util-fbserver', () => ({}))
    const mod = await import('./vercel-log-drain')
    mod.resetDrainBudgetForTests()
    return mod
  }

  function mockFetch(): jest.Mock {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  const OK_ENTRY = {
    id: '1',
    source: 'lambda',
    host: 'app.aglyn.com',
    level: 'info',
    statusCode: 200,
    path: '/api/orgs',
    proxy: { method: 'GET', statusCode: 200, path: '/api/orgs?page=1' },
  }

  const ERROR_ENTRY = {
    id: '2',
    source: 'lambda',
    host: 'app.aglyn.com',
    level: 'error',
    statusCode: 500,
    path: '/[host]/[[...slug]]',
    message: 'Task timed out after 10.01 seconds',
    proxy: { method: 'POST', statusCode: 500, path: '/checkout?cart=SECRET' },
  }

  /*========================================================================
   * THE COST GATE. A drain streams EVERY request log; writing all of them
   * turns a $20/month budget into a large bill.
   *======================================================================*/

  it('writes NOTHING for a delivery of healthy 200s', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    const result = await mod.ingestDrainDelivery([OK_ENTRY, OK_ENTRY, OK_ENTRY])
    expect(result).toMatchObject({ received: 3, matched: 0, forwarded: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes EXACTLY ONE entry, to the vercel-runtime log, for one 500', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    const result = await mod.ingestDrainDelivery([
      OK_ENTRY,
      ERROR_ENTRY,
      OK_ENTRY,
    ])

    expect(result).toMatchObject({ received: 3, matched: 1, forwarded: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logName).toBe(
      `projects/aglyn-main/logs/${mod.VERCEL_RUNTIME_LOG_ID}`,
    )
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].severity).toBe('ERROR')
    // The field the proposed alert policy matches on.
    expect(body.entries[0].httpRequest.status).toBe(500)
  })

  it('never writes into server-errors — the other arm owns that log', async () => {
    // The alert policy 11610705614308437855 keys on `server-errors`. Mixing
    // the streams would count one incident twice and make triage start by
    // asking which arm saw it.
    const fetchMock = mockFetch()
    const mod = await load()
    await mod.ingestDrainDelivery([ERROR_ENTRY])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.logName).not.toContain('server-errors')
    expect(body.logName).not.toContain('client-errors')
    expect(mod.VERCEL_RUNTIME_LOG_ID).toContain('vercel')
  })

  it('forwards a crashed lambda (statusCode -1) — the hook cannot see it', async () => {
    const mod = await load()
    expect(mod.isServerErrorEntry({ statusCode: -1, source: 'lambda' })).toBe(
      true,
    )
    expect(mod.isServerErrorEntry({ level: 'fatal' })).toBe(true)
    expect(mod.isServerErrorEntry({ type: 'fatal' })).toBe(true)
  })

  it('does NOT forward proxy.statusCode -1 — that is ISR revalidation', async () => {
    // Same sentinel, opposite meaning. Reading it as a crash would forward a
    // permanent trickle of perfectly healthy traffic.
    const mod = await load()
    expect(
      mod.isServerErrorEntry({ proxy: { statusCode: -1 }, statusCode: 200 }),
    ).toBe(false)
  })

  it('does NOT forward a plain console.error line', async () => {
    // `level: "error"` is any console.error, including the beacons' own
    // fail-soft lines. Per-line billing for a stream the hook already covers.
    const mod = await load()
    expect(
      mod.isServerErrorEntry({ level: 'error', type: 'stderr', message: 'hm' }),
    ).toBe(false)
  })

  /*========================================================================
   * THE DELIBERATE 503. `/api/locked` answers a takedown with a real 503 on
   * purpose; forwarded, a suspended host being crawled reads as an outage.
   *======================================================================*/

  it('DROPS the lockdown notice 503 — that status is the feature', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    // The shape the middleware produces: every path of a locked host is
    // rewritten here, so `path` is the route and the visitor's URL is gone.
    const notice = {
      id: '3',
      source: 'lambda',
      host: 'acme.aglyn.app',
      level: 'error',
      statusCode: 503,
      path: mod.LOCKDOWN_NOTICE_ROUTE_PATH,
      proxy: { method: 'GET', statusCode: 503, path: mod.LOCKDOWN_NOTICE_ROUTE_PATH },
    }
    const result = await mod.ingestDrainDelivery([notice])
    expect(result).toMatchObject({ received: 1, matched: 0, forwarded: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops it on proxy.path alone, query and all', async () => {
    const mod = await load()
    expect(
      mod.isLockdownNoticeEntry({
        proxy: {
          statusCode: 503,
          path: `${mod.LOCKDOWN_NOTICE_ROUTE_PATH}?host=acme.aglyn.app`,
        },
      }),
    ).toBe(true)
  })

  it('still forwards a lockdown notice that is itself BROKEN', async () => {
    // The exemption must not make the route unwatchable: if the notice throws
    // or its lambda dies, a locked host serves nothing at all and that is a
    // real incident.
    const fetchMock = mockFetch()
    const mod = await load()
    const base = {
      id: '4',
      source: 'lambda',
      host: 'acme.aglyn.app',
      path: mod.LOCKDOWN_NOTICE_ROUTE_PATH,
    }
    expect(mod.isLockdownNoticeEntry({ ...base, statusCode: 500 })).toBe(false)
    expect(mod.isLockdownNoticeEntry({ ...base, statusCode: -1 })).toBe(false)
    expect(
      mod.isLockdownNoticeEntry({ ...base, statusCode: 503, level: 'fatal' }),
    ).toBe(false)

    const result = await mod.ingestDrainDelivery([{ ...base, statusCode: 500 }])
    expect(result).toMatchObject({ matched: 1, forwarded: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('exempts ONLY that path — a 503 anywhere else is still an outage', async () => {
    const mod = await load()
    expect(
      mod.isLockdownNoticeEntry({ statusCode: 503, path: '/api/health' }),
    ).toBe(false)
    // Matched exactly, not as a prefix: a future child route carries no such
    // guarantee about its status.
    expect(
      mod.isLockdownNoticeEntry({ statusCode: 503, path: '/api/locked/debug' }),
    ).toBe(false)
    // A 503 the platform served with no route attached stays forwardable.
    expect(mod.isLockdownNoticeEntry({ statusCode: 503 })).toBe(false)
  })

  /*========================================================================
   * THE FEEDBACK LOOP. The receiver runs on the console, whose logs this
   * same drain collects.
   *======================================================================*/

  it('DROPS entries from its own route, even 500s', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    const own = {
      ...ERROR_ENTRY,
      path: mod.RECEIVER_ROUTE_PATH,
      proxy: { method: 'POST', statusCode: 500, path: mod.RECEIVER_ROUTE_PATH },
    }
    const result = await mod.ingestDrainDelivery([own])
    expect(result).toMatchObject({ received: 1, matched: 0, forwarded: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops its own route matched on proxy.path alone, query and all', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    const own = {
      id: '9',
      statusCode: 502,
      proxy: { statusCode: 502, path: `${mod.RECEIVER_ROUTE_PATH}?x=1` },
    }
    expect(await mod.ingestDrainDelivery([own])).toMatchObject({ forwarded: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /*========================================================================
   * PII. Nothing beyond what the shipped beacons already send.
   *======================================================================*/

  it('never forwards the query-bearing proxy.path or a client IP', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    await mod.ingestDrainDelivery([
      {
        ...ERROR_ENTRY,
        proxy: {
          ...ERROR_ENTRY.proxy,
          path: '/checkout?token=SECRET',
        },
      } as never,
    ])
    const raw = fetchMock.mock.calls[0][1].body
    expect(raw).not.toContain('SECRET')
    expect(raw).not.toContain('token=')
    expect(raw).not.toContain('clientIp')
    // The route PATTERN is what survives — same field the hook sends.
    expect(JSON.parse(raw).entries[0].jsonPayload.route).toBe(
      '/[host]/[[...slug]]',
    )
  })

  /*========================================================================
   * THE BUDGET. Bounded cost, and lossiness that REPORTS itself.
   *======================================================================*/

  it('suppresses past the per-window budget and REPORTS the suppression', async () => {
    const fetchMock = mockFetch()
    const mod = await load()
    const warn = jest.spyOn(console, 'warn')
    const flood = Array.from({ length: 200 }, (_, i) => ({
      ...ERROR_ENTRY,
      id: String(i),
    }))

    const result = await mod.ingestDrainDelivery(flood)
    expect(result.matched).toBe(200)
    expect(result.forwarded).toBe(60)
    expect(result.suppressed).toBe(140)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).entries).toHaveLength(60)

    // A second delivery in the same window writes nothing more...
    const second = await mod.ingestDrainDelivery(flood)
    expect(second.forwarded).toBe(0)
    expect(second.suppressed).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // ...and when the window rolls over, the drop count is REPORTED rather
    // than quietly forgotten. A monitoring path that hides its own lossiness
    // is the bug shape this repo keeps finding.
    warn.mockClear()
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    const third = await mod.ingestDrainDelivery([ERROR_ENTRY])
    expect(third.forwarded).toBe(1)
    const reported = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('AGL-1921:vercel-log-drain'))
    expect(reported).toHaveLength(1)
    expect(JSON.parse(reported[0]).suppressed).toBe(340)
  })

  /*========================================================================
   * FAIL-SOFT. Vercel disables a drain whose endpoint errors often enough.
   *======================================================================*/

  it('reports a stable code and never throws when Logging refuses', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'PERMISSION_DENIED projects/aglyn-main/...',
    }) as unknown as typeof fetch
    const mod = await load()
    const result = await mod.ingestDrainDelivery([ERROR_ENTRY])
    expect(result).toMatchObject({ forwarded: 0, code: 'http-403' })
    expect(JSON.stringify(result)).not.toContain('PERMISSION_DENIED')
  })

  it('never throws on a transport failure', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    const mod = await load()
    await expect(mod.ingestDrainDelivery([ERROR_ENTRY])).resolves.toMatchObject(
      {
        forwarded: 0,
        code: 'transport',
      },
    )
  })
})

describe('parseDrainPayload (AGL-1921) — both delivery formats', () => {
  // Imported lazily so the firebase-admin side effect stays inside the mocked
  // module registry of the ingest suite above.
  async function parser() {
    jest.doMock('firebase-admin/app', () => ({
      getApp: () => ({ options: {} }),
    }))
    jest.doMock('@aglyn/shared-util-fbserver', () => ({}))
    return (await import('./vercel-log-drain')).parseDrainPayload
  }

  it('parses the json format (an array)', async () => {
    const parse = await parser()
    expect(parse('[{"id":"a"},{"id":"b"}]')).toHaveLength(2)
  })

  it('parses the ndjson format (one object per line)', async () => {
    const parse = await parser()
    expect(parse('{"id":"a"}\n{"id":"b"}\n')).toHaveLength(2)
  })

  it('skips a malformed line rather than failing the delivery', async () => {
    // A receiver that 500s on one bad line gets its drain disabled by Vercel.
    const parse = await parser()
    expect(parse('{"id":"a"}\nnot json\n{"id":"b"}')).toHaveLength(2)
  })

  it('returns [] for an empty or unusable body', async () => {
    const parse = await parser()
    expect(parse('')).toEqual([])
    expect(parse('   ')).toEqual([])
    expect(parse('"a string"')).toEqual([])
  })
})
