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
 * THE TWO FAULTS IN `await (user as any)?.getIdToken?.()`, WATCHED AT THE WIRE.
 *
 * Every assertion here is made against `global.fetch`, never against a double
 * standing in for this module: the defect is precisely that a surface can
 * look correct at its own seam while putting nothing on the wire, or while
 * putting something unauthenticated on it.
 *
 * * The AWAIT is unbounded. Firebase refreshes against Google's token
 *   endpoint with no deadline of its own, and every caller awaits that
 *   promise BEFORE building its request — so a refresh that is never
 *   answered is not a slow request, it is no request at all, forever, with
 *   nothing for a `!response.ok` arm to report.
 * * The HEADER is conditional. `...(idToken ? { Authorization } : {})` means
 *   a caller who could not be authorized sends the request anyway, without
 *   credentials — a request that should never have left the browser.
 */

import {
  AuthorizationUnavailableError,
  ID_TOKEN_TIMEOUT_MS,
  authorizedFetch,
  describeCallFailure,
  resolveIdToken,
} from './authorized-token'

/** One request as it actually left, headers included. */
interface WireCall {
  url: string
  method: string
  authorization: string | undefined
  body: string | undefined
}

let wire: WireCall[] = []

beforeEach(() => {
  wire = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init: RequestInit = {}) => {
      wire.push({
        url: String(url),
        method: String(init.method ?? 'GET'),
        authorization: (init.headers as Record<string, string> | undefined)
          ?.Authorization,
        body: init.body as string | undefined,
      })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    },
  )
})

afterEach(() => {
  jest.useRealTimers()
})

/** An account that mints `token`. */
const mints = (token = 'token-abc') => ({
  getIdToken: jest.fn(async () => token),
})

describe('a request is authorized or it is not made', () => {
  it('POSITIVE CONTROL: carries the token this account actually minted', async () => {
    /*
     * The anti-vacuity assertion. Everything below is of the form "nothing
     * was issued", which a helper that never calls `fetch` satisfies
     * perfectly — and a header asserted against a constant somebody wrote
     * into a stub proves only that the stub is self-consistent. The value
     * has to follow the account.
     */
    const account = mints('token-from-this-account-only')
    const response = await authorizedFetch(account, '/api/thing', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })

    expect(response.ok).toBe(true)
    expect(wire).toHaveLength(1)
    expect(wire[0].url).toBe('/api/thing')
    expect(wire[0].method).toBe('POST')
    expect(wire[0].authorization).toBe('Bearer token-from-this-account-only')
    expect(wire[0].body).toBe(JSON.stringify({ a: 1 }))
    expect(account.getIdToken).toHaveBeenCalled()
  })

  it('keeps the headers the caller asked for, alongside the one it adds', async () => {
    await authorizedFetch(mints(), '/api/thing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const headers = (
      (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
    ).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBe('Bearer token-abc')
  })

  it('issues NOTHING when the account cannot mint a token', async () => {
    // The route would refuse this on its own terms, and the surface would
    // report "that failed" to somebody whose actual problem is that they
    // are signed out.
    const response = await authorizedFetch(
      { getIdToken: async () => '' },
      '/api/thing',
      { method: 'POST' },
    )

    expect(wire).toHaveLength(0)
    expect(response.ok).toBe(false)
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/signed out/i)
  })

  it('issues NOTHING when there is no account at all', async () => {
    const response = await authorizedFetch(null, '/api/thing')

    expect(wire).toHaveLength(0)
    expect(response.status).toBe(401)
  })

  it('issues NOTHING when the refresh is rejected, and names the reason', async () => {
    const response = await authorizedFetch(
      {
        getIdToken: async () => {
          throw new Error('auth/network-request-failed')
        },
      },
      '/api/thing',
    )

    expect(wire).toHaveLength(0)
    const payload = await response.json()
    expect(payload.error).toMatch(/could not be confirmed/i)
    expect(payload.error).toMatch(/auth\/network-request-failed/)
  })

  it('gives up on a token that never settles, within the deadline', async () => {
    /*
     * THE FAULT THIS FILE EXISTS FOR. A refresh whose network call is never
     * answered leaves the promise pending for the life of the page, and it
     * is awaited in FRONT of the request — so the surface issues nothing,
     * reports nothing, and leaves its button latched on `busy` forever.
     */
    jest.useFakeTimers()
    const call = authorizedFetch(
      { getIdToken: () => new Promise<string>(() => undefined) },
      '/api/thing',
      { method: 'POST' },
    )
    await jest.advanceTimersByTimeAsync(ID_TOKEN_TIMEOUT_MS + 100)
    const response = await call

    expect(wire).toHaveLength(0)
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(
      /could not be confirmed in time/i,
    )
  })

  it('does not wait the whole deadline when the token is there', async () => {
    // The other half of the timeout: a live token answers immediately, and
    // the pending timer must not hold the process (or the test) open.
    jest.useFakeTimers()
    const call = authorizedFetch(mints(), '/api/thing')
    await jest.advanceTimersByTimeAsync(0)
    await call
    expect(wire).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('sends through the caller’s own fetch when it supplies one', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as never
    await authorizedFetch(mints(), '/api/thing', {}, { fetchImpl })

    expect(wire).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledWith('/api/thing', {
      headers: { Authorization: 'Bearer token-abc' },
    })
  })

  it('asks for a fresh token when the caller needs one', async () => {
    // The surfaces that read a claim granted moments ago: answering from the
    // cached token would report the very absence being investigated.
    const account = mints()
    await authorizedFetch(account, '/api/thing', {}, { forceRefresh: true })

    expect(account.getIdToken).toHaveBeenCalledWith(true)
    expect(wire[0].authorization).toBe('Bearer token-abc')
  })
})

describe('resolveIdToken, for callers that need the token itself', () => {
  it('answers with the token', async () => {
    await expect(resolveIdToken(mints('tok'))).resolves.toBe('tok')
  })

  it('refuses rather than answering with nothing', async () => {
    // `undefined` is what `getIdToken?.()` gives a signed-out account, and
    // handing it back is what let a missing token become a missing header.
    await expect(resolveIdToken(undefined)).rejects.toBeInstanceOf(
      AuthorizationUnavailableError,
    )
    await expect(resolveIdToken({})).rejects.toMatchObject({
      reason: 'signed-out',
    })
  })

  it('names which of the three ways it failed', async () => {
    jest.useFakeTimers()
    const call = resolveIdToken({
      getIdToken: () => new Promise<string>(() => undefined),
    }).catch((error: unknown) => error)
    await jest.advanceTimersByTimeAsync(ID_TOKEN_TIMEOUT_MS + 1)
    expect(await call).toMatchObject({ reason: 'timeout' })

    jest.useRealTimers()
    await expect(
      resolveIdToken({
        getIdToken: async () => {
          throw new Error('nope')
        },
      }),
    ).rejects.toMatchObject({ reason: 'rejected' })
  })

  it('honors a caller’s own deadline', async () => {
    jest.useFakeTimers()
    const call = resolveIdToken(
      { getIdToken: () => new Promise<string>(() => undefined) },
      { timeoutMs: 25 },
    ).catch((error: unknown) => error)
    await jest.advanceTimersByTimeAsync(26)
    expect(await call).toBeInstanceOf(AuthorizationUnavailableError)
  })
})

describe('describeCallFailure', () => {
  it('lets an authorization failure speak for itself', () => {
    const error = new AuthorizationUnavailableError('timeout', 'Not in time.')
    expect(describeCallFailure(error, 'An error has occurred')).toBe(
      'Not in time.',
    )
  })

  it('falls back for anything else, because the news is different', () => {
    // A network error mid-send and a send that never left are not the same
    // thing to say to somebody.
    expect(describeCallFailure(new Error('boom'), 'Send failed')).toBe(
      'Send failed',
    )
  })
})
