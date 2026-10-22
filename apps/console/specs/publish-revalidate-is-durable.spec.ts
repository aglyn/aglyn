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
 * A PUBLISH HAS TO SURVIVE ONE BAD ANSWER (AGL-2573).
 *
 * The announce to the tenant is the only thing that makes a publish visible
 * before the document TTL, and it used to be a single attempt: any non-ok
 * response ended it. That is what turned eleven days of edge 429s into eleven
 * days of hour-late publishes for every site on the platform — the failure was
 * transient every single time, and nothing ever asked again.
 *
 * Two properties are asserted here and they pull against each other, which is
 * why both are written down. A retryable refusal must be retried; and none of
 * that retrying may ever turn a completed publish into a failed one, because
 * the pointer is already written by the time any of this runs.
 *
 * The third property is the one that made the outage last eleven days rather
 * than an afternoon: the announce now says something when it WORKS, so an
 * empty log search stops being ambiguous between "healthy" and "never called".
 */

import postTenantRevalidate from '../utils/server/tenant-revalidate'

const OLD_SECRET = process.env['REVALIDATE_SECRET']
const OLD_FETCH = global.fetch

const okResponse = (revalidated: string[] = ['/acme/']) => ({
  ok: true,
  status: 200,
  json: async () => ({ revalidated, truncated: 0 }),
})

const refusal = (status: number) => ({
  ok: false,
  status,
  json: async () => ({ error: 'nope' }),
})

/** The tag every telemetry line carries, and the thing a log search greps. */
const TELEMETRY_TAG = 'AGL-2573:tenant-revalidate'

/** Parse the tagged JSON lines out of a `console.log` spy. */
const telemetryLines = (spy: jest.SpyInstance): Record<string, unknown>[] =>
  spy.mock.calls
    .map(([first]) => {
      try {
        return JSON.parse(String(first)) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter(
      (line): line is Record<string, unknown> =>
        Boolean(line) && line?.['tag'] === TELEMETRY_TAG,
    )

describe('the publish announce is durable (AGL-2573)', () => {
  let fetchMock: jest.Mock
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    process.env['REVALIDATE_SECRET'] = 'test-secret'
    fetchMock = jest.fn(async () => okResponse())
    global.fetch = fetchMock as never
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    if (OLD_SECRET === undefined) delete process.env['REVALIDATE_SECRET']
    else process.env['REVALIDATE_SECRET'] = OLD_SECRET
    global.fetch = OLD_FETCH
  })

  it('asks again when the tenant answers 429, and succeeds', async () => {
    // The eleven-day outage exactly: the edge refused before the route ran.
    fetchMock
      .mockResolvedValueOnce(refusal(429))
      .mockResolvedValueOnce(okResponse(['/acme/pricing']))

    const result = await postTenantRevalidate({
      subdomain: 'acme',
      hostId: 'h1',
      paths: ['/pricing'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The publish is reported as what it is — fully propagated — rather than
    // as a shortfall the editor has to explain to somebody.
    expect(result.reason).toBe('ok')
    expect(result.revalidated).toEqual(['/acme/pricing'])
  })

  it('asks again when the tenant answers 503', async () => {
    fetchMock
      .mockResolvedValueOnce(refusal(503))
      .mockResolvedValueOnce(okResponse())

    const result = await postTenantRevalidate({
      subdomain: 'acme',
      hostId: 'h1',
      paths: ['/'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.reason).toBe('ok')
  })

  it('asks again when there is no answer at all', async () => {
    // A timeout and a dropped connection are the same "ask again" class as a
    // 429; before this they were the terminal `reason: 'error'`.
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(okResponse())

    const result = await postTenantRevalidate({
      subdomain: 'acme',
      hostId: 'h1',
      paths: ['/'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.reason).toBe('ok')
  })

  it('does NOT ask again when the answer will not change', async () => {
    // A 401 is a wrong secret and a 400 is a wrong payload. Retrying either
    // spends the budget arriving at the same refusal three times, and the
    // budget is inside a publish somebody is waiting on.
    fetchMock.mockResolvedValue(refusal(401))

    const result = await postTenantRevalidate({
      subdomain: 'acme',
      hostId: 'h1',
      paths: ['/'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.reason).toBe('tenant-401')
  })

  it('gives up after a bounded number of attempts', async () => {
    // Bounded, because the caller is a publish response and not a daemon.
    fetchMock.mockResolvedValue(refusal(429))

    const result = await postTenantRevalidate({
      subdomain: 'acme',
      hostId: 'h1',
      paths: ['/'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.reason).toBe('tenant-429')
  })

  it('never throws, and never reports a publish as failed', async () => {
    // The pointer is already written when this runs. Whatever happens here,
    // the publish itself succeeded, so this must resolve rather than reject.
    fetchMock.mockRejectedValue(new Error('everything is on fire'))

    await expect(
      postTenantRevalidate({ subdomain: 'acme', hostId: 'h1', paths: ['/'] }),
    ).resolves.toEqual({ revalidated: [], reason: 'error', pathsDropped: 0 })
  })

  describe('the announce says something when it works', () => {
    it('emits a tagged line on SUCCESS, not only on failure', async () => {
      // The whole point. Before this, a successful drop logged nothing, so a
      // log search that found nothing could not tell a healthy platform from
      // one whose publish hop had been dead for eleven days.
      await postTenantRevalidate({
        subdomain: 'acme',
        hostId: 'h1',
        paths: ['/', '/pricing'],
      })

      const lines = telemetryLines(logSpy)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        tag: TELEMETRY_TAG,
        host: 'acme',
        hostId: 'h1',
        paths: 2,
        reason: 'ok',
        attempts: 1,
      })
    })

    it('records the reason and the attempt count when it fails', async () => {
      fetchMock.mockResolvedValue(refusal(429))

      await postTenantRevalidate({
        subdomain: 'acme',
        hostId: 'h1',
        paths: ['/'],
      })

      const lines = telemetryLines(logSpy)
      expect(lines).toHaveLength(1)
      // The attempt count is what distinguishes "one bad moment" from "the
      // tenant is refusing every time we ask".
      expect(lines[0]).toMatchObject({ reason: 'tenant-429', attempts: 3 })
    })

    it('says so when revalidation is not configured at all', async () => {
      // A silent no-op here is indistinguishable from a slow cache, which is
      // the confusion this whole mechanism exists to end.
      delete process.env['REVALIDATE_SECRET']

      const result = await postTenantRevalidate({
        subdomain: 'acme',
        hostId: 'h1',
        paths: ['/'],
      })

      expect(result.reason).toBe('not-configured')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(telemetryLines(logSpy)[0]).toMatchObject({
        reason: 'not-configured',
      })
    })
  })
})
