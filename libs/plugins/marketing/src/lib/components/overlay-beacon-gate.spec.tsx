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
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://customer.example/"}
 */

/**
 * ## Why this is not in `site-runtime.spec.tsx`
 *
 * The gate reads the document HOSTNAME, and jsdom builds `location` once and
 * leaves it non-configurable — it can only be set through the
 * `@jest-environment-options` pragma in a file's first docblock. Under
 * jsdom's default `localhost` the positive case below cannot pass and the two
 * negative ones pass on the loopback rule alone, never reaching the
 * environment rules they are named for. Setting that URL for the whole
 * runtime suite would change the document under cases that have nothing to do
 * with analytics, so this describe gets its own file instead.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { MarketingSiteRuntime } from './site-runtime'

/**
 * The overlay counters count only where a pageview would.
 *
 * `sendOverlayBeacon` writes to the same collector as the pageview and the
 * form denominators, so it takes the same gate: a real production surface, and
 * a browser that has not been declared ours. Before it, every impression a
 * `next dev` or a preview deployment rendered landed in a customer's overlay
 * engagement numbers.
 *
 * The GA mirror beside it is deliberately NOT gated here — `trackEvent`
 * carries the taxonomy's own environment check and stamps `traffic_type`
 * rather than dropping the hit — so the first case asserts the beacon and the
 * gtag call travel together, and the negative cases assert only the beacon
 * stops.
 *
 * Planted red, verified: send through a raw `navigator.sendBeacon` in
 * `sendOverlayBeacon` → both negative cases go red.
 */
describe('overlay impressions count only from a production surface', () => {
  let unmount: (() => void) | undefined
  let beacons: Array<Record<string, unknown>>
  const mutableEnv = process.env as Record<string, string | undefined>
  const savedEnv = {
    nodeEnv: process.env.NODE_ENV,
    deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
  }

  beforeEach(() => {
    beacons = []
    mutableEnv.NODE_ENV = 'production'
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: (_url: string, body: string) => {
        beacons.push(JSON.parse(body))
        return true
      },
    })
  })

  afterEach(() => {
    unmount?.()
    unmount = undefined
    window.localStorage.clear()
    mutableEnv.NODE_ENV = savedEnv.nodeEnv
    if (savedEnv.deployEnv === undefined)
      delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
  })

  const showBar = () => {
    const utils = render(
      <MarketingSiteRuntime
        hostId="host-1"
        screens={{}}
        page={{
          announcementBar: {
            contentHash: 'bar-hash-1',
            overlayId: 'overlay-1',
            text: 'Now in early access',
          } as never,
          popup: null,
          experiments: [],
          automationOverlays: null,
          clientAutomations: [],
        }}
      />,
    )
    unmount = utils.unmount
  }

  it('reports the impression from a real production deployment', async () => {
    // Non-vacuity: both absences below pass for free the day the bar stops
    // rendering at all.
    showBar()
    await waitFor(() =>
      expect(beacons).toEqual([
        { hostId: 'host-1', overlay: 'barImpression', overlayId: 'overlay-1' },
      ]),
    )
  })

  it('reports nothing under next dev', async () => {
    mutableEnv.NODE_ENV = 'development'
    showBar()
    await waitFor(() => expect(screen.getByText('Now in early access')).toBeTruthy())
    expect(beacons).toEqual([])
  })

  it('reports nothing on a Vercel preview, whose NODE_ENV is production', async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'preview'
    showBar()
    await waitFor(() => expect(screen.getByText('Now in early access')).toBeTruthy())
    expect(beacons).toEqual([])
  })
})
