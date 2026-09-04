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
 * Which beacons reach the metered collector.
 *
 * The GA gate answers "may this build load a tag"; this one answers "may this
 * pageview be BILLED", and the two differ in exactly one place that matters:
 * `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD`. A dev build running with the hatch
 * emits to GA on purpose and stamps every hit `traffic_type: 'internal'` —
 * hits declared ours. Counting those would put a developer's afternoon on a
 * customer's invoice, so the hatch must buy a GA session and never an
 * increment. That asymmetry is what the `describe` below is mostly about.
 *
 * Planted reds, verified:
 *   - drop the `analyticsEnvironmentForcesInternal` line from
 *     `analyticsBeaconMaySend` → the escape-hatch case goes red.
 *   - drop the `analyticsMayEmit` line → localhost and preview go red.
 *   - negate the override return → every internal-browser case goes red.
 *   - return `true` unconditionally from the `sendBeacon` catch → the
 *     "throwing browser" case goes red.
 */

import {
  ANALYTICS_BEACON_ENDPOINT,
  analyticsBeaconMaySend,
  sendAnalyticsBeacon,
} from './analytics-beacon'
import {
  ANALYTICS_ALLOW_NONPROD_ENV,
  type AnalyticsEnvironment,
} from './analytics-environment'
import {
  INTERNAL_TRAFFIC_QUERY_PARAM,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
} from './internal-traffic'

/** A `localStorage` that is real enough for the override to use. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string): string | null =>
      map.has(key) ? map.get(key)! : null,
    setItem: (key: string, value: string): void =>
      void map.set(key, String(value)),
    removeItem: (key: string): void => void map.delete(key),
    _map: map,
  }
}

/** A browser that has NOT been declared ours. */
const external = () => ({ search: '', storage: fakeStorage() })

/** Our own production deployment, the only environment that counts. */
const PRODUCTION: AnalyticsEnvironment = {
  nodeEnv: 'production',
  deployEnv: 'production',
  hostname: 'aglyn.com',
}

describe('analyticsBeaconMaySend — the build', () => {
  it('counts a real production deployment', () => {
    expect(
      analyticsBeaconMaySend({ env: PRODUCTION, override: external() }),
    ).toBe(true)
  })

  it('counts an UNKNOWN production deployment — the self-host default', () => {
    // Docker + bring-your-own-Firebase sets no VERCEL_ENV and writes into the
    // operator's own project. Their counters are theirs.
    expect(
      analyticsBeaconMaySend({
        env: { nodeEnv: 'production', hostname: 'sites.example.com' },
        override: external(),
      }),
    ).toBe(true)
  })

  it('counts nothing from localhost', () => {
    // The defect this gate closes: `apps/tenant/.env` names the PRODUCTION
    // Firebase project, so a `next dev` browsing a tenant site incremented a
    // live customer's metered page views.
    expect(
      analyticsBeaconMaySend({
        env: { nodeEnv: 'development', hostname: 'localhost' },
        override: external(),
      }),
    ).toBe(false)
    // A production BUILD served over loopback is the self-host compose case
    // (`{subdomain}.localhost:4500`) and a container run from a clone. Both
    // carry `NODE_ENV=production` with no deploy env, so the hostname is the
    // only signal that separates them from a real deployment.
    expect(
      analyticsBeaconMaySend({
        env: { nodeEnv: 'production', hostname: 'demo.localhost' },
        override: external(),
      }),
    ).toBe(false)
  })

  it('counts nothing from a Vercel preview', () => {
    // A preview build has NODE_ENV === 'production'; only the deploy env sees
    // it, which is why both next.configs map VERCEL_ENV into the bundle.
    expect(
      analyticsBeaconMaySend({
        env: {
          nodeEnv: 'production',
          deployEnv: 'preview',
          hostname: 'tenant-git-branch.vercel.app',
        },
        override: external(),
      }),
    ).toBe(false)
  })

  it('counts nothing from a build using the ANALYTICS escape hatch', () => {
    // ⚑ The one place this gate and `analyticsMayEmit` deliberately disagree.
    // The hatch exists to exercise the GA taxonomy against DebugView, and it
    // is paired with `analyticsEnvironmentForcesInternal` so every hit it
    // produces is declared ours. A hit declared ours is never billed.
    const hatched: AnalyticsEnvironment = {
      nodeEnv: 'development',
      hostname: 'localhost',
      allowNonProduction: '1',
    }
    expect(analyticsBeaconMaySend({ env: hatched, override: external() })).toBe(
      false,
    )
  })

  it('still counts production when the hatch is set there', () => {
    // The hatch must not become a blanket kill switch on the surface that
    // actually earns: in production `analyticsEnvironmentForcesInternal` is
    // false, so the hatch changes nothing here.
    expect(
      analyticsBeaconMaySend({
        env: { ...PRODUCTION, allowNonProduction: '1' },
        override: external(),
      }),
    ).toBe(true)
    expect(ANALYTICS_ALLOW_NONPROD_ENV).toBe(
      'NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD',
    )
  })
})

describe('analyticsBeaconMaySend — the browser', () => {
  it('counts nothing from a browser we declared ours', () => {
    expect(
      analyticsBeaconMaySend({
        env: PRODUCTION,
        override: {
          search: '',
          storage: fakeStorage({
            [INTERNAL_TRAFFIC_STORAGE_KEY]: INTERNAL_TRAFFIC_VALUE,
          }),
        },
      }),
    ).toBe(false)
  })

  it('suppresses the very pageview that carries `?aglyn_internal=1`', () => {
    // Reading the override applies it. GA can stamp that first hit and let a
    // data filter drop it later; a counter has no later — it is a running
    // total that feeds an invoice — so the visit that opts in must not be
    // counted either.
    const storage = fakeStorage()
    expect(
      analyticsBeaconMaySend({
        env: PRODUCTION,
        override: { search: `?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`, storage },
      }),
    ).toBe(false)
    // ...and it stays off for the next pageview, with no parameter on the URL.
    expect(analyticsBeaconMaySend({ env: PRODUCTION, override: { search: '', storage } })).toBe(
      false,
    )
  })

  it('counts again once the browser opts back out', () => {
    const storage = fakeStorage({
      [INTERNAL_TRAFFIC_STORAGE_KEY]: INTERNAL_TRAFFIC_VALUE,
    })
    expect(
      analyticsBeaconMaySend({
        env: PRODUCTION,
        override: { search: `?${INTERNAL_TRAFFIC_QUERY_PARAM}=0`, storage },
      }),
    ).toBe(true)
  })

  it('counts a browser that refuses storage', () => {
    // Opt-in only, never inferred. Private mode, a sandboxed iframe and a
    // server render all resolve to NOT internal, because wrongly flagging a
    // real visitor under-counts a customer's own dashboard as well as ours.
    expect(
      analyticsBeaconMaySend({ env: PRODUCTION, override: { storage: null } }),
    ).toBe(true)
  })
})

describe('sendAnalyticsBeacon', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let sent: Array<[string, string]>

  const installNavigator = (sendBeacon: (url: string, body: string) => boolean) =>
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
      writable: true,
    })

  beforeEach(() => {
    sent = []
    installNavigator((url, body) => {
      sent.push([url, body])
      return true
    })
  })

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete (globalThis as Record<string, unknown>)['navigator']
  })

  it('sends the payload as JSON to the collector', () => {
    expect(
      sendAnalyticsBeacon(
        { hostId: 'h1', path: '/pricing' },
        { env: PRODUCTION, override: external() },
      ),
    ).toBe(true)
    expect(sent).toEqual([
      [ANALYTICS_BEACON_ENDPOINT, '{"hostId":"h1","path":"/pricing"}'],
    ])
  })

  it('issues NO REQUEST AT ALL when the gate refuses', () => {
    // Not "sends and the server discards": a refused beacon must cost no
    // request, no rate-limit budget and no Firestore write.
    expect(
      sendAnalyticsBeacon(
        { hostId: 'h1' },
        { env: { nodeEnv: 'development' }, override: external() },
      ),
    ).toBe(false)
    expect(sent).toEqual([])
  })

  it('never throws when the browser refuses the beacon', () => {
    installNavigator(() => {
      throw new Error('blocked')
    })
    expect(
      sendAnalyticsBeacon(
        { hostId: 'h1' },
        { env: PRODUCTION, override: external() },
      ),
    ).toBe(false)
  })
})
