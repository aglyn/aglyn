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

import {
  analyticsProviders,
  analyticsTagResident,
  applyAnalyticsConsent,
  loadAnalyticsProviders,
  registerAnalyticsProvider,
  resetAnalyticsProviders,
  sendAnalyticsProviderEvent,
  subscribeAnalyticsProviders,
  type AnalyticsGrants,
  type AnalyticsProvider,
} from './analytics-provider'

/** An adapter that records what core told it. */
function recordingProvider(resident = true) {
  const consent: AnalyticsGrants[] = []
  const events: Array<{ name: string; params: Record<string, unknown>; options?: unknown }> = []
  const provider: AnalyticsProvider = {
    mounts: () => [],
    applyConsent: (grants) => {
      consent.push(grants)
      return ['ID-1']
    },
    resident: () => resident,
    sendEvent: (name, params, options) => {
      events.push({ name, params, options })
    },
  }
  return { provider, consent, events }
}

afterEach(() => resetAnalyticsProviders())

describe('the analytics provider registry (AGL-3080)', () => {
  it('tells every registered adapter the visitor’s answer, advertising clamped to analytics', () => {
    const one = recordingProvider()
    const two = recordingProvider()
    registerAnalyticsProvider('one', one.provider)
    registerAnalyticsProvider('two', two.provider)
    expect(applyAnalyticsConsent({ analytics: false, advertising: true })).toEqual([
      'ID-1',
      'ID-1',
    ])
    expect(one.consent).toEqual([{ analytics: false, advertising: false }])
    expect(two.consent).toEqual([{ analytics: false, advertising: false }])
  })

  it('hands an answer given BEFORE an adapter registered to that adapter at once', () => {
    // The console's tag is injected by its SDK, not by an adapter, so it can
    // be resident before the adapter arrives. A withdrawal in that window has
    // to reach it the moment something can speak to it. Forced red: drop the
    // replay in `registerAnalyticsProvider` and this fails.
    applyAnalyticsConsent({ analytics: false, advertising: false })
    const late = recordingProvider()
    registerAnalyticsProvider('late', late.provider)
    expect(late.consent).toEqual([{ analytics: false, advertising: false }])
  })

  it('replays nothing when no answer was given in this document', () => {
    const fresh = recordingProvider()
    registerAnalyticsProvider('fresh', fresh.provider)
    expect(fresh.consent).toEqual([])
  })

  it('delivers an event only to a resident tag, and says whether one took it', () => {
    const absent = recordingProvider(false)
    registerAnalyticsProvider('absent', absent.provider)
    expect(analyticsTagResident()).toBe(false)
    expect(sendAnalyticsProviderEvent('LCP', { value: 1 })).toBe(false)
    expect(absent.events).toEqual([])

    const present = recordingProvider(true)
    registerAnalyticsProvider('present', present.provider)
    expect(analyticsTagResident()).toBe(true)
    expect(
      sendAnalyticsProviderEvent('LCP', { value: 1 }, { measurementOnly: true }),
    ).toBe(true)
    expect(present.events).toEqual([
      { name: 'LCP', params: { value: 1 }, options: { measurementOnly: true } },
    ])
  })

  it('survives an adapter that throws', () => {
    registerAnalyticsProvider('broken', {
      mounts: () => {
        throw new Error('x')
      },
      applyConsent: () => {
        throw new Error('x')
      },
      resident: () => {
        throw new Error('x')
      },
      sendEvent: () => {
        throw new Error('x')
      },
    })
    expect(applyAnalyticsConsent({ analytics: true, advertising: false })).toEqual([])
    expect(analyticsTagResident()).toBe(false)
    expect(sendAnalyticsProviderEvent('LCP', {})).toBe(false)
  })

  it('loads each adapter once, registers it, and tells subscribers', async () => {
    const { provider } = recordingProvider()
    const load = jest.fn(async () => ({ analyticsProvider: provider }))
    const heard = jest.fn()
    const unsubscribe = subscribeAnalyticsProviders(heard)
    await Promise.all([
      loadAnalyticsProviders([{ pluginId: 'p', load }]),
      loadAnalyticsProviders([{ pluginId: 'p', load }]),
    ])
    unsubscribe()
    expect(load).toHaveBeenCalledTimes(1)
    expect(analyticsProviders()).toEqual([provider])
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('leaves a provider whose chunk fails unregistered, without throwing', async () => {
    await expect(
      loadAnalyticsProviders([
        { pluginId: 'gone', load: () => Promise.reject(new Error('chunk')) },
      ]),
    ).resolves.toBeUndefined()
    expect(analyticsProviders()).toEqual([])
  })

  it('keeps the snapshot stable between registrations', () => {
    const first = analyticsProviders()
    expect(analyticsProviders()).toBe(first)
    registerAnalyticsProvider('p', recordingProvider().provider)
    expect(analyticsProviders()).not.toBe(first)
  })
})
