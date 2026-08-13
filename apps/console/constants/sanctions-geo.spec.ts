/**
 * @jest-environment node
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

import {
  enforceSanctionsGeo,
  GEO_COUNTRY_HEADER,
  GEO_REGION_HEADER,
  NO_SIGNAL_LOG_INTERVAL_MS,
  readRequestGeo,
  resetSanctionsTelemetry,
  SANCTIONS_LOG_PREFIX,
  sanctionsVerdict,
} from './sanctions-geo'

/**
 * The policy the ToS §3.6 commitment rests on (AGL-1492).
 *
 * Two things are asserted separately on purpose: that the POLICY answers
 * correctly for every country and region named in §3.6, and — in
 * `middleware.spec.ts` and against a live server — that the policy is actually
 * REACHED. A geo helper that returns the right verdict and is never called is
 * not a control.
 */

const headers = (values: Record<string, string>) => new Headers(values)

beforeEach(() => resetSanctionsTelemetry())

describe('readRequestGeo', () => {
  it('reads and uppercases the Vercel edge headers', () => {
    expect(
      readRequestGeo(headers({ [GEO_COUNTRY_HEADER]: 'us', [GEO_REGION_HEADER]: 'tx' })),
    ).toEqual({ country: 'US', region: 'TX' })
  })

  it('reports an absent signal as null rather than an empty string', () => {
    expect(readRequestGeo(headers({}))).toEqual({ country: null, region: null })
    expect(readRequestGeo(headers({ [GEO_COUNTRY_HEADER]: '  ' }))).toEqual({
      country: null,
      region: null,
    })
  })

  it.each([
    ['43', '43'],
    ['UA-43', '43'],
    ['9', '09'],
    ['ua-09', '09'],
  ])('normalizes subdivision %s to %s', (raw, expected) => {
    expect(
      readRequestGeo(headers({ [GEO_COUNTRY_HEADER]: 'UA', [GEO_REGION_HEADER]: raw }))
        .region,
    ).toBe(expected)
  })
})

describe('sanctionsVerdict — the countries ToS §3.6 names', () => {
  it.each(['CU', 'IR', 'KP', 'SY'])('blocks %s', (country) => {
    const verdict = sanctionsVerdict({ country, region: null })
    expect(verdict.blocked).toBe(true)
    expect(verdict.outcome).toBe('blocked-country')
  })

  it.each(['US', 'GB', 'DE', 'UA', 'RU', 'BY', 'CN'])(
    'allows %s — only a comprehensive embargo is in scope',
    (country) => {
      expect(sanctionsVerdict({ country, region: null }).blocked).toBe(false)
    },
  )
})

describe('sanctionsVerdict — the sub-country regions a country check misses', () => {
  it.each([
    ['43', 'Crimea'],
    ['40', 'Sevastopol'],
    ['14', 'Donetsk'],
    ['09', 'Luhansk'],
  ])('blocks UA-%s (%s)', (region) => {
    const verdict = sanctionsVerdict({ country: 'UA', region })
    expect(verdict.blocked).toBe(true)
    expect(verdict.outcome).toBe('blocked-region')
  })

  it('allows the rest of Ukraine — Kyiv is not embargoed', () => {
    expect(sanctionsVerdict({ country: 'UA', region: '30' }).blocked).toBe(false)
  })

  it('does not apply UA subdivision codes to other countries', () => {
    // RU-14 is Sakha, not Donetsk. A country-agnostic region check would be
    // wrong, not merely over-broad.
    expect(sanctionsVerdict({ country: 'RU', region: '14' }).blocked).toBe(false)
  })

  it('allows UA with no subdivision, but flags it as unresolved', () => {
    const verdict = sanctionsVerdict({ country: 'UA', region: null })
    expect(verdict.blocked).toBe(false)
    expect(verdict.outcome).toBe('region-unresolved')
  })
})

describe('sanctionsVerdict — absent signal', () => {
  it('FAILS OPEN, and says so in the outcome', () => {
    const verdict = sanctionsVerdict({ country: null, region: null })
    expect(verdict.blocked).toBe(false)
    expect(verdict.outcome).toBe('no-signal')
  })
})

describe('enforceSanctionsGeo', () => {
  it('returns a 451 for an embargoed country', async () => {
    const log = jest.fn()
    const response = enforceSanctionsGeo(
      headers({ [GEO_COUNTRY_HEADER]: 'IR' }),
      'page',
      { log },
    )
    expect(response?.status).toBe(451)
    expect(response?.headers.get('Cache-Control')).toContain('no-store')
    expect(await response?.text()).toContain('Unavailable in your region')
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`${SANCTIONS_LOG_PREFIX} refused blocked-country`),
    )
  })

  it('returns a 451 JSON body for API callers', async () => {
    const response = enforceSanctionsGeo(
      headers({ [GEO_COUNTRY_HEADER]: 'UA', [GEO_REGION_HEADER]: '14' }),
      'json',
      { log: jest.fn() },
    )
    expect(response?.status).toBe(451)
    expect(await response?.json()).toMatchObject({ reason: 'sanctions' })
  })

  it('returns null for an allowed region', () => {
    const log = jest.fn()
    expect(
      enforceSanctionsGeo(headers({ [GEO_COUNTRY_HEADER]: 'US' }), 'page', { log }),
    ).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('never caches a refusal — a cached 451 would block the next requester', () => {
    const response = enforceSanctionsGeo(headers({ [GEO_COUNTRY_HEADER]: 'CU' }), 'page', {
      log: jest.fn(),
    })
    expect(response?.headers.get('Cache-Control')).toBe(
      'no-store, no-cache, must-revalidate',
    )
  })

  describe('the absent signal is OBSERVABLE, not silent', () => {
    it('logs the fail-open, then throttles with a running count', () => {
      const log = jest.fn()
      const none = headers({})

      expect(enforceSanctionsGeo(none, 'page', { now: 0, log })).toBeNull()
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(`${SANCTIONS_LOG_PREFIX} FAILING OPEN`),
      )

      // Same instance, same minute: counted, not re-logged.
      enforceSanctionsGeo(none, 'page', { now: 1_000, log })
      expect(log).toHaveBeenCalledTimes(1)

      // Past the interval: logged again, carrying the count of everything the
      // control could not evaluate.
      enforceSanctionsGeo(none, 'page', { now: NO_SIGNAL_LOG_INTERVAL_MS + 1, log })
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining('3 request(s)'))
    })

    it('logs every unresolvable Ukraine subdivision', () => {
      const log = jest.fn()
      enforceSanctionsGeo(headers({ [GEO_COUNTRY_HEADER]: 'UA' }), 'page', { log })
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Crimea/Donetsk/Luhansk not evaluable'),
      )
    })
  })
})
