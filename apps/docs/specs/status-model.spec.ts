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
 * The /status page must be able to go red, and must not leak (AGL-2411).
 *
 * Two failures this suite exists to make impossible, both of which this repo
 * has already shipped once:
 *
 *  - **A surface that cannot report bad news.** `/api/health/crons` sat at 503
 *    for fifty-one hours while every HEAD probe answered a hardcoded 200. The
 *    equivalent here is a status page that rounds "I could not read that" up
 *    to green, so `never reports operational without our own 200 + status:ok`
 *    is asserted as a matrix over every other shape a reply can take.
 *  - **Internals on a public page.** The health bodies carry `commit`,
 *    `region`, `host`, and counts that describe business volume. The
 *    redaction test feeds a body full of them and asserts none survives.
 */

import {
  initialReadings,
  overallStatus,
  parseTargets,
  probeTarget,
  probeUrl,
  publicDetail,
  readingFromError,
  readingFromResponse,
  targetHost,
  DEFAULT_HEALTH_PATH,
  OVERALL_SUMMARY,
  type Reading,
  type StatusTarget,
} from '../src/status-model'

/**
 * jsdom's `AbortSignal` has not always carried the static `timeout` helper the
 * probe uses. Polyfilled rather than branched around in the source: a runtime
 * check in `probeTarget` would be a silent path where the 10s bound does not
 * apply, which is exactly the sort of "works, quietly wrong" this file is for.
 */
if (typeof AbortSignal.timeout !== 'function') {
  ;(AbortSignal as unknown as Record<string, unknown>)['timeout'] = () =>
    new AbortController().signal
}

const target = (over: Partial<StatusTarget> = {}): StatusTarget => ({
  name: 'console',
  label: 'Console',
  description: 'Sign-in and editing',
  base: 'https://console.example.com',
  path: DEFAULT_HEALTH_PATH,
  ...over,
})

/** A `fetch` that resolves one canned response. */
function fetchReturning(status: number, body: unknown | (() => never)): typeof fetch {
  return (async () =>
    ({
      status,
      json: async () => {
        if (typeof body === 'function') (body as () => never)()
        return body
      },
    }) as unknown as Response) as unknown as typeof fetch
}

describe('parseTargets', () => {
  it('reads nothing from an unset, blank or non-string value', () => {
    expect(parseTargets(undefined)).toEqual([])
    expect(parseTargets(null)).toEqual([])
    expect(parseTargets('')).toEqual([])
    expect(parseTargets('   ')).toEqual([])
    expect(parseTargets(['console'])).toEqual([])
  })

  it('keeps the documented four-field grammar working', () => {
    expect(
      parseTargets(
        'console|Console|https://console.example.com|Sign-in and editing',
      ),
    ).toEqual([
      {
        name: 'console',
        label: 'Console',
        base: 'https://console.example.com',
        description: 'Sign-in and editing',
        path: DEFAULT_HEALTH_PATH,
      },
    ])
  })

  it('accepts an optional fifth field naming a subsystem health path', () => {
    const [parsed] = parseTargets(
      'render|Site rendering|https://sites.example.com|A real page renders|/api/health/render/site',
    )
    expect(parsed.path).toBe('/api/health/render/site')
    expect(probeUrl(parsed, 1234)).toBe(
      'https://sites.example.com/api/health/render/site?at=1234',
    )
  })

  it('refuses a path that is not rooted, rather than pasting it onto the origin', () => {
    const [parsed] = parseTargets(
      'render|Rendering|https://sites.example.com||api/health/render/site',
    )
    expect(parsed.path).toBe(DEFAULT_HEALTH_PATH)
  })

  it('drops an entry with no origin and falls back label→name', () => {
    expect(parseTargets('broken|Broken||no origin,ok||https://a.example.com/')).toEqual([
      {
        name: 'ok',
        label: 'ok',
        base: 'https://a.example.com',
        description: '',
        path: DEFAULT_HEALTH_PATH,
      },
    ])
  })

  it('names the host a visitor can recognise', () => {
    expect(targetHost(target())).toBe('console.example.com')
    expect(targetHost(target({ base: 'not a url' }))).toBe('not a url')
  })
})

describe('readingFromResponse', () => {
  it('is operational only for our own 200 + status ok', () => {
    expect(readingFromResponse(200, { status: 'ok' }, 12)).toEqual({
      verdict: 'operational',
      ms: 12,
    })
  })

  it.each([
    ['a 200 with an unreadable body', 200, null],
    ['a 200 of HTML from a proxy', 200, '<!doctype html>'],
    ['a 200 that claims nothing', 200, { service: 'console' }],
    ['a bot-protection challenge', 429, null],
    ['a missing route', 404, null],
    ['a redirect body', 302, null],
    ['a status of some other word', 200, { status: 'maintenance' }],
  ])('reads %s as unknown, never as operational', (_label, status, body) => {
    const reading = readingFromResponse(status as number, body, 5)
    expect(reading.verdict).toBe('unknown')
  })

  it('reads any 5xx as degraded even when the body cannot be parsed', () => {
    expect(readingFromResponse(503, null, 7)).toEqual({
      verdict: 'degraded',
      ms: 7,
      detail: 'the service returned an error',
    })
    expect(readingFromResponse(500, '<html>', 7).verdict).toBe('degraded')
  })

  it('believes a body that admits degradation even on a 200', () => {
    const reading = readingFromResponse(
      200,
      { status: 'degraded', checks: { firestore: { ok: false } } },
      9,
    )
    expect(reading.verdict).toBe('degraded')
  })
})

describe('publicDetail', () => {
  it('names an allowlisted check in plain words', () => {
    expect(
      publicDetail({ status: 'degraded', checks: { firestore: { ok: false } } }),
    ).toBe('the data store is not responding normally')
    expect(
      publicDetail({
        status: 'degraded',
        checks: { firestore: { ok: false }, render: { ok: false } },
      }),
    ).toBe('the data store and page rendering are not responding normally')
  })

  it('collapses any check it does not recognise to a generic phrase', () => {
    expect(
      publicDetail({
        status: 'degraded',
        checks: { signupRefusals: { ok: false }, meteredPricing: { ok: false } },
      }),
    ).toBe('a dependency is not responding normally')
  })

  it('leaks nothing from a body full of internals', () => {
    const detail = publicDetail({
      status: 'degraded',
      service: 'console-signups',
      commit: '5f35acf',
      version: '1.0.0-beta.8',
      environment: 'production',
      region: 'sfo1',
      checks: {
        signups: {
          ok: false,
          code: 'signup-wave',
          recentOrgCreations: 4127,
          threshold: 10,
        },
        render: { ok: false, host: 'acme-customer', nodeCount: 107 },
      },
    })
    for (const secret of [
      '5f35acf',
      'sfo1',
      'production',
      'console-signups',
      'signup-wave',
      '4127',
      'acme-customer',
      '107',
      'signups',
      'beta',
    ]) {
      expect(detail).not.toContain(secret)
    }
    expect(detail).toBe(
      'a dependency and page rendering are not responding normally',
    )
  })

  it('still says something when a degraded body lists no failing check', () => {
    expect(publicDetail({ status: 'degraded' })).toBe(
      'the service reported a problem',
    )
    expect(publicDetail(null)).toBe('the service reported a problem')
  })
})

describe('probeTarget', () => {
  it('reports operational, with the elapsed time, on a healthy answer', async () => {
    let clock = 1_000
    const reading = await probeTarget(target(), {
      fetch: fetchReturning(200, { status: 'ok' }),
      now: () => (clock += 40) - 40,
    })
    expect(reading).toEqual({ verdict: 'operational', ms: 40 })
  })

  it('reports unknown — NOT operational — when the body cannot be parsed', async () => {
    const reading = await probeTarget(target(), {
      fetch: fetchReturning(200, () => {
        throw new SyntaxError('Unexpected token <')
      }),
    })
    expect(reading.verdict).toBe('unknown')
  })

  it('reports unknown when the fetch itself fails', async () => {
    const reading = await probeTarget(target(), {
      fetch: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    })
    expect(reading.verdict).toBe('unknown')
    expect(reading.detail).toBe(
      'this check could not be completed from your browser',
    )
  })

  it('says so when nothing answered in time', () => {
    const reading = readingFromError({ name: 'TimeoutError' }, 10_000)
    expect(reading.verdict).toBe('unknown')
    expect(reading.detail).toBe('no answer within 10s')
  })

  it('uses the ambient fetch when none is injected, and calls it bound', async () => {
    // The page passes no `fetch`, because passing the bare global unbound
    // throws `Illegal invocation` in a browser and turned every card into
    // "no reading" on a healthy day. `this` is asserted, not just the result:
    // a spec that only checked the verdict would pass for the broken version
    // under jsdom, which is how the bug reached a browser in the first place.
    const previous = (globalThis as Record<string, any>)['fetch']
    const seen: unknown[] = []
    ;(globalThis as Record<string, any>)['fetch'] = function (this: unknown) {
      seen.push(this)
      return Promise.resolve({
        status: 200,
        json: async () => ({ status: 'ok' }),
      } as unknown as Response)
    }
    try {
      expect((await probeTarget(target())).verdict).toBe('operational')
      expect(seen[0]).toBe(globalThis)
    } finally {
      ;(globalThis as Record<string, any>)['fetch'] = previous
    }
  })

  it('asks for a fresh reading every time', async () => {
    const seen: string[] = []
    const spy = (async (url: string) => {
      seen.push(String(url))
      return { status: 200, json: async () => ({ status: 'ok' }) } as unknown as Response
    }) as unknown as typeof fetch
    let clock = 5
    await probeTarget(target(), { fetch: spy, now: () => clock++ })
    await probeTarget(target(), { fetch: spy, now: () => clock++ })
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).toContain('?at=')
  })
})

describe('overallStatus', () => {
  const reading = (verdict: Reading['verdict']): Reading => ({ verdict })

  it('says unconfigured — never all-clear — when nothing is being checked', () => {
    expect(overallStatus([], {})).toBe('unconfigured')
    expect(OVERALL_SUMMARY.unconfigured).toContain('not configured')
  })

  it('never claims health for a target that has not answered yet', () => {
    expect(overallStatus([target()], {})).toBe('checking')
    expect(overallStatus([target()], initialReadings([target()]))).toBe('checking')
  })

  it('leads with degraded when anything is degraded', () => {
    const two = [target(), target({ name: 'sites' })]
    expect(
      overallStatus(two, { console: reading('operational'), sites: reading('degraded') }),
    ).toBe('degraded')
    expect(
      overallStatus(two, { console: reading('unknown'), sites: reading('degraded') }),
    ).toBe('degraded')
  })

  it('will not call it operational while any check has no reading', () => {
    const two = [target(), target({ name: 'sites' })]
    expect(
      overallStatus(two, { console: reading('operational'), sites: reading('unknown') }),
    ).toBe('unknown')
  })

  it('is operational only when every target read green', () => {
    expect(overallStatus([target()], { console: reading('operational') })).toBe(
      'operational',
    )
  })
})
