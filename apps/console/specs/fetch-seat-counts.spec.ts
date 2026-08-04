/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * AGL-1255: a seat count that could not be read must be `null`, never `0`.
 *
 * The billing page's downgrade check did `.catch(() => 0)`. A denied read
 * became "0 team members", `0 > managersPerOrg` is false, and the warning that
 * the downgrade would strand the org over its seat limit was silently omitted.
 * The failure direction was the reassuring one, which is the worst available
 * for a confirmation dialog.
 *
 * Every test below is about that single property: there is no input for which
 * this returns a number it did not actually receive.
 */

import { fetchSeatCounts } from '../utils/fetch-seat-counts'

const user = { getIdToken: async () => 'tok' }

const stubFetch = (impl: () => Promise<Response>) => {
  global.fetch = jest.fn(impl) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('fetchSeatCounts (AGL-1255)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the counts the server gave', async () => {
    stubFetch(async () => json({ managerSeats: 2, memberCount: 5 }))
    await expect(fetchSeatCounts(user, 'o1')).resolves.toEqual({
      managerSeats: 2,
      memberCount: 5,
    })
  })

  it('asks the counts-only endpoint, not the roster one', async () => {
    const calls: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return json({ managerSeats: 1, memberCount: 1 })
    }) as unknown as typeof fetch
    await fetchSeatCounts(user, 'o1')
    // Requesting the roster to get one integer would hand every caller the
    // names and emails AGL-1026 restricted.
    expect(calls[0]).toContain('counts=1')
    expect(calls[0]).toContain('orgId=o1')
  })

  it('is null on a denied/failed response — NOT zero', async () => {
    stubFetch(async () => json({ error: 'nope' }, 403))
    // The whole point. `0` here is what removed the downgrade warning.
    await expect(fetchSeatCounts(user, 'o1')).resolves.toBeNull()
  })

  it('is null when the network throws', async () => {
    stubFetch(async () => {
      throw new Error('offline')
    })
    await expect(fetchSeatCounts(user, 'o1')).resolves.toBeNull()
  })

  it('is null when the payload is not a number', async () => {
    // A 200 with a malformed body is the case that would sail past a bare
    // `response.ok` check and become `NaN` — which compares false against
    // every limit, exactly like 0 did.
    stubFetch(async () => json({ managerSeats: 'lots', memberCount: 5 }))
    await expect(fetchSeatCounts(user, 'o1')).resolves.toBeNull()
  })

  it('is null with no signed-in user, without calling fetch', async () => {
    const spy = jest.fn()
    global.fetch = spy as unknown as typeof fetch
    await expect(fetchSeatCounts(undefined, 'o1')).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('is null with no org, without calling fetch', async () => {
    const spy = jest.fn()
    global.fetch = spy as unknown as typeof fetch
    await expect(fetchSeatCounts(user, undefined)).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('CONTROL — zero really is reported when the server says zero', async () => {
    // Without this, "never zero" could be satisfied by a function that maps
    // every zero to null — which would warn about a limit nobody is near.
    stubFetch(async () => json({ managerSeats: 0, memberCount: 0 }))
    await expect(fetchSeatCounts(user, 'o1')).resolves.toEqual({
      managerSeats: 0,
      memberCount: 0,
    })
  })
})
