/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://shop.example.com/pricing?utm_source=news&utm_campaign=fall"}
 */
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

const mockSend = jest.fn((_payload: Record<string, unknown>) => true)
jest.mock('./analytics-beacon', () => ({
  sendAnalyticsBeacon: (payload: Record<string, unknown>) => mockSend(payload),
}))

import {
  configureSiteJourney,
  hostRecordsJourneys,
  recordSiteJourneyStep,
  resetSiteJourneyForTests,
  SITE_JOURNEY_BEACON_FIELD,
  SITE_JOURNEY_ID_PATTERN,
  SITE_JOURNEY_MAX_STEPS,
} from './site-journey'

const sent = () => mockSend.mock.calls.map(([payload]) => payload)

beforeEach(() => {
  mockSend.mockClear()
  window.sessionStorage.clear()
  resetSiteJourneyForTests()
})

describe('the visit recorder (AGL-3605)', () => {
  it('records nothing while consent is unresolved, and keeps any visit it holds', () => {
    window.sessionStorage.setItem(
      'aglyn-journey',
      JSON.stringify({ id: 'a'.repeat(22), hostId: 'h1', steps: 1 }),
    )
    configureSiteJourney({ hostId: 'h1', enabled: null, path: '/pricing' })
    recordSiteJourneyStep('form', 'f1')
    expect(sent()).toEqual([])
    expect(window.sessionStorage.getItem('aglyn-journey')).not.toBeNull()
  })

  it('records nothing for a refusal, and forgets the visit so a later grant starts a new one', () => {
    window.sessionStorage.setItem(
      'aglyn-journey',
      JSON.stringify({ id: 'a'.repeat(22), hostId: 'h1', steps: 1 }),
    )
    configureSiteJourney({ hostId: 'h1', enabled: false, path: '/pricing' })
    recordSiteJourneyStep('form', 'f1')
    expect(sent()).toEqual([])
    expect(window.sessionStorage.getItem('aglyn-journey')).toBeNull()
  })

  it('records the page the visitor is on at the moment of the grant, with where the visit came from', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/pricing' })
    expect(sent()).toHaveLength(1)
    const [first] = sent()
    expect(first).toMatchObject({
      hostId: 'h1',
      stepType: 'page',
      stepKey: '/pricing',
      journeyStart: true,
      utmSource: 'news',
      utmCampaign: 'fall',
    })
    expect(String(first[SITE_JOURNEY_BEACON_FIELD])).toMatch(SITE_JOURNEY_ID_PATTERN)
  })

  it('ties later steps to the same visit, sends the source once, and records a page once per move', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/pricing' })
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/pricing' })
    recordSiteJourneyStep('form', 'contact')
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/thanks' })
    const payloads = sent()
    expect(payloads.map((p) => [p['stepType'], p['stepKey']])).toEqual([
      ['page', '/pricing'],
      ['form', 'contact'],
      ['page', '/thanks'],
    ])
    const ids = new Set(payloads.map((p) => p[SITE_JOURNEY_BEACON_FIELD]))
    expect(ids.size).toBe(1)
    expect(payloads.slice(1).some((p) => 'journeyStart' in p || 'utmSource' in p)).toBe(false)
  })

  it('records a reload of the same step once', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/a' })
    recordSiteJourneyStep('page', '/a')
    expect(sent()).toHaveLength(1)
  })

  it('stops at the cap per visit', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/start' })
    for (let index = 0; index < SITE_JOURNEY_MAX_STEPS + 10; index += 1) {
      recordSiteJourneyStep('event', `e_${index}`)
    }
    expect(sent()).toHaveLength(SITE_JOURNEY_MAX_STEPS)
  })

  it('refuses steps that are not steps', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/start' })
    mockSend.mockClear()
    recordSiteJourneyStep('page', 'no-slash')
    recordSiteJourneyStep('event', '')
    recordSiteJourneyStep('nope' as never, 'x')
    expect(sent()).toEqual([])
  })

  it('mints a new visit for another site in the same tab', () => {
    configureSiteJourney({ hostId: 'h1', enabled: true, path: '/a' })
    configureSiteJourney({ hostId: 'h2', enabled: true, path: '/a' })
    const [one, two] = sent()
    expect(one[SITE_JOURNEY_BEACON_FIELD]).not.toBe(two[SITE_JOURNEY_BEACON_FIELD])
    expect(two['journeyStart']).toBe(true)
  })
})

describe('hostRecordsJourneys', () => {
  it('is true only for a strict true', () => {
    expect(hostRecordsJourneys({ funnelRecording: true })).toBe(true)
    expect(hostRecordsJourneys({ funnelRecording: 'true' })).toBe(false)
    expect(hostRecordsJourneys(null)).toBe(false)
  })
})
