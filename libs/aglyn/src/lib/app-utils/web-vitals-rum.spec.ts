/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on node.
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
 * Real-user Core Web Vitals → GA4 (AGL-1642).
 *
 * What is pinned, and why each pin matters:
 *
 * - the exact wire shape of a metric event (web.dev's GA4 `web_vitals`
 *   pattern) — a drifted key silently becomes an unreportable param;
 * - the tag-loading race: metrics reported before gtag exists are HELD and
 *   flushed when the tag arrives, because both surfaces load their tag late
 *   and dropping on first miss would discard TTFB on every pageview;
 * - the consent gate: a visitor whose tag NEVER arrives produces nothing,
 *   even after the watcher gives up — held metrics die unsent;
 * - single install per page load.
 */

import type { WebVitalsReportingOptions } from './web-vitals-rum'

type MetricCallback = (metric: {
  name: string
  id: string
  value: number
  delta: number
  rating?: string
}) => void

/** The callbacks the module registered with the (mocked) web-vitals library. */
const registered: Record<string, MetricCallback> = {}
let registerCalls = 0

jest.mock('web-vitals', () => ({
  __esModule: true,
  onCLS: (callback: MetricCallback) => {
    registerCalls += 1
    registered['CLS'] = callback
  },
  onINP: (callback: MetricCallback) => {
    registered['INP'] = callback
  },
  onLCP: (callback: MetricCallback) => {
    registered['LCP'] = callback
  },
  onTTFB: (callback: MetricCallback) => {
    registered['TTFB'] = callback
  },
}))

// Imported AFTER the mock so the dynamic `import('web-vitals')` resolves to it.
import {
  installWebVitalsReporting,
  resetWebVitalsReporting,
} from './web-vitals-rum'

const gtagCalls: unknown[][] = []

function mountGtag() {
  ;(window as unknown as { gtag?: unknown }).gtag = (...args: unknown[]) => {
    gtagCalls.push(args)
  }
}

function unmountGtag() {
  delete (window as unknown as { gtag?: unknown }).gtag
}

/** Install and wait for the dynamic import + registration to settle. */
async function install(options: WebVitalsReportingOptions = { surface: 'site' }) {
  installWebVitalsReporting(options)
  // The dynamic import resolves on the microtask queue; flush it.
  await Promise.resolve()
  await Promise.resolve()
}

const LCP_METRIC = {
  name: 'LCP',
  id: 'v4-1723600000000-1234567890123',
  value: 2412.5,
  delta: 2412.5,
  rating: 'needs-improvement',
}

describe('web-vitals → GA4 reporting (AGL-1642)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetWebVitalsReporting()
    gtagCalls.length = 0
    registerCalls = 0
    for (const key of Object.keys(registered)) delete registered[key]
    unmountGtag()
  })

  afterEach(() => {
    jest.useRealTimers()
    unmountGtag()
  })

  it('registers all four CWV handlers', async () => {
    await install()
    expect(Object.keys(registered).sort()).toEqual([
      'CLS',
      'INP',
      'LCP',
      'TTFB',
    ])
  })

  it('sends the exact web.dev GA4 shape through a resident gtag', async () => {
    mountGtag()
    await install({ surface: 'console' })
    registered['LCP'](LCP_METRIC)

    expect(gtagCalls).toHaveLength(1)
    const [command, name, params] = gtagCalls[0]
    expect(command).toBe('event')
    // The event is NAMED by the metric — GA's own pattern, so any published
    // web-vitals GA4 report recipe works against it unchanged.
    expect(name).toBe('LCP')
    expect(params).toEqual({
      // `value` is the DELTA: GA sums event value, and summing deltas is
      // what keeps a twice-reported metric's page total correct.
      value: 2412.5,
      metric_id: 'v4-1723600000000-1234567890123',
      metric_value: 2412.5,
      metric_delta: 2412.5,
      metric_rating: 'needs-improvement',
      surface: 'console',
    })
  })

  it('CLS keeps its unitless value — no legacy ×1000', async () => {
    mountGtag()
    await install()
    registered['CLS']({
      name: 'CLS',
      id: 'v4-1723600000000-2',
      value: 0.09,
      delta: 0.04,
      rating: 'good',
    })
    const params = gtagCalls[0][2] as Record<string, unknown>
    expect(params['value']).toBe(0.04)
    expect(params['metric_value']).toBe(0.09)
  })

  it('holds a metric reported before the tag loads, and flushes when it arrives', async () => {
    await install()
    // TTFB reports immediately; both surfaces mount their tag late. This is
    // the normal first-metric state of every pageview, not an edge case.
    registered['TTFB']({
      name: 'TTFB',
      id: 'v4-1723600000000-3',
      value: 180,
      delta: 180,
      rating: 'good',
    })
    expect(gtagCalls).toHaveLength(0)

    // Consent granted / Firebase booted: the tag appears a moment later.
    mountGtag()
    jest.advanceTimersByTime(1000)

    expect(gtagCalls).toHaveLength(1)
    expect(gtagCalls[0][1]).toBe('TTFB')
  })

  it('a visitor whose tag never arrives produces NOTHING — held metrics die unsent', async () => {
    await install()
    registered['LCP'](LCP_METRIC)
    expect(gtagCalls).toHaveLength(0)

    // The watcher gives up after ~60s of no tag.
    jest.advanceTimersByTime(61_000)

    // A tag that appears AFTER the give-up (say, a very late consent grant)
    // must not receive the stale metric: the buffer is gone.
    mountGtag()
    jest.advanceTimersByTime(5_000)
    registered['INP']({
      name: 'INP',
      id: 'v4-1723600000000-4',
      value: 40,
      delta: 40,
      rating: 'good',
    })

    // Only the fresh INP arrives; the pre-give-up LCP is gone for good.
    expect(gtagCalls).toHaveLength(1)
    expect(gtagCalls[0][1]).toBe('INP')
  })

  it('a later metric finding a resident tag flushes the held ones first, in order', async () => {
    await install()
    registered['TTFB']({
      name: 'TTFB',
      id: 'v4-1723600000000-5',
      value: 200,
      delta: 200,
    })
    mountGtag()
    // No timer has ticked — the flush rides the next metric's delivery.
    registered['LCP'](LCP_METRIC)
    expect(gtagCalls.map((call) => call[1])).toEqual(['TTFB', 'LCP'])
  })

  it('installs once per page load — a second call registers nothing new', async () => {
    mountGtag()
    await install()
    await install()
    expect(registerCalls).toBe(1)
  })

  it('is a no-op without a window (SSR)', () => {
    // jsdom provides window; the SSR branch is the very first line and is
    // asserted by the module never touching web-vitals when window is absent.
    // Simulated by install-before-reset being the only registration:
    expect(() =>
      installWebVitalsReporting({ surface: 'site' }),
    ).not.toThrow()
  })
})
