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
 * The Google tag adapter (AGL-3080): what a Google Analytics id and a Tag
 * Manager container put on a published page, and how a resident Google tag is
 * silenced and addressed.
 *
 * The page-level behavior — the consent gate, the nonce, the platform's own
 * property on `aglyn.com` — is pinned by the tenant app's specs, which reach
 * this adapter through the generated manifest. This file pins the adapter's
 * own output byte for byte, because an inline boot that drifts still runs.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GOOGLE_ADS_VENDOR } from '@aglyn/aglyn/app-utils/advertising-tags'
import { PLATFORM_GA_MEASUREMENT_ID } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import { INTERNAL_TRAFFIC_GTAG_SNIPPET } from '@aglyn/aglyn/app-utils/internal-traffic'
import {
  analyticsProvider,
  applyGoogleTagConsent,
  GA_CLICK_ID_PASSTHROUGH_SNIPPET,
  GA_CONSENT_DEFAULT_SNIPPET,
  GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET,
  GA_DISABLE_FLAG_PREFIX,
  GTAG_LIBRARY,
  residentGaMeasurementIds,
} from './analytics-provider'

const SHIM =
  'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
const GRANTED = { consentRequired: true, advertising: false }
const scope = () => window as unknown as Record<string, any>

afterEach(() => {
  delete scope().gtag
  delete scope().dataLayer
  for (const key of Object.keys(scope())) {
    if (key.startsWith(GA_DISABLE_FLAG_PREFIX)) delete scope()[key]
  }
  document.head.innerHTML = ''
})

describe('what a site’s settings mount', () => {
  it('mounts nothing for a site with no tag, or a malformed one', () => {
    expect(analyticsProvider.mounts(null, GRANTED)).toEqual([])
    expect(analyticsProvider.mounts({ analytics: {} }, GRANTED)).toEqual([])
    expect(
      analyticsProvider.mounts(
        { analytics: { gaMeasurementId: "G-'+alert(1)+'", gtmContainerId: 'nope' } },
        GRANTED,
      ),
    ).toEqual([])
  })

  it('boots a customer’s GA id with the consent default, and nothing of ours', () => {
    const [mount] = analyticsProvider.mounts(
      { analytics: { gaMeasurementId: 'G-TEST1234' } },
      GRANTED,
    )
    expect(mount).toEqual({
      id: 'ga',
      boot:
        SHIM +
        GA_CONSENT_DEFAULT_SNIPPET +
        "gtag('js', new Date());" +
        "gtag('config', 'G-TEST1234');",
      src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234',
      library: GTAG_LIBRARY,
    })
  })

  it('declares no default when the host runs its own consent solution', () => {
    const [mount] = analyticsProvider.mounts(
      { analytics: { gaMeasurementId: 'G-TEST1234' } },
      { consentRequired: false, advertising: false },
    )
    expect(mount.boot).toBe(
      SHIM + "gtag('js', new Date());gtag('config', 'G-TEST1234');",
    )
  })

  it('declares the advertising grant when the visitor gave one', () => {
    const [mount] = analyticsProvider.mounts(
      { analytics: { gaMeasurementId: 'G-TEST1234' } },
      { consentRequired: true, advertising: true },
    )
    expect(mount.boot).toContain(GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET)
    expect(mount.boot).not.toContain(GA_CONSENT_DEFAULT_SNIPPET)
  })

  it('stamps the platform’s own property, before config, and only it', () => {
    const [mount] = analyticsProvider.mounts(
      { analytics: { gaMeasurementId: PLATFORM_GA_MEASUREMENT_ID } },
      GRANTED,
    )
    expect(mount.boot).toBe(
      SHIM +
        GA_CONSENT_DEFAULT_SNIPPET +
        INTERNAL_TRAFFIC_GTAG_SNIPPET +
        GA_CLICK_ID_PASSTHROUGH_SNIPPET +
        "gtag('js', new Date());" +
        `gtag('config', '${PLATFORM_GA_MEASUREMENT_ID}', {'content_group':'marketing'});`,
    )
  })

  it('boots a container with the consent default and no noscript fallback', () => {
    const mounts = analyticsProvider.mounts(
      { analytics: { gtmContainerId: 'GTM-ABC1234' } },
      GRANTED,
    )
    expect(mounts).toEqual([
      {
        id: 'gtm',
        boot:
          SHIM +
          GA_CONSENT_DEFAULT_SNIPPET +
          "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});",
        src: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234',
      },
    ])
  })

  it('mounts GA before the container when a site configures both', () => {
    expect(
      analyticsProvider
        .mounts(
          { analytics: { gaMeasurementId: 'G-TEST1234', gtmContainerId: 'GTM-ABC1234' } },
          GRANTED,
        )
        .map((mount) => mount.id),
    ).toEqual(['ga', 'gtm'])
  })

  it('names gtag.js the way the Google Ads vendor does, so it rides this loader', () => {
    expect(GTAG_LIBRARY).toBe(GOOGLE_ADS_VENDOR.sharesLibrary)
  })

  it('keeps the LOAD-TIME default denying advertising', () => {
    // The default is emitted as a constant into an inline script before the
    // tag loads, and it must not vary by visitor: a granting default would
    // be a declaration made before the record is even read.
    expect(GA_CONSENT_DEFAULT_SNIPPET).toContain('"ad_storage":"denied"')
    expect(GA_CONSENT_DEFAULT_SNIPPET).not.toContain('"ad_storage":"granted"')
  })
})

describe('which tags are resident', () => {
  it('reads the measurement id off a loaded gtag.js script', () => {
    const script = document.createElement('script')
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234'
    document.head.appendChild(script)
    expect(residentGaMeasurementIds()).toEqual(['G-TEST1234'])
  })

  it('also reads it off a dataLayer config, which is what GTM leaves', () => {
    scope().dataLayer = [['js', new Date()], ['config', 'G-FROMLAYER']]
    expect(residentGaMeasurementIds()).toEqual(['G-FROMLAYER'])
  })

  it('refuses a malformed id rather than writing a junk window flag', () => {
    const script = document.createElement('script')
    script.src = 'https://www.googletagmanager.com/gtag/js?id=not-an-id'
    document.head.appendChild(script)
    scope().dataLayer = [['config', 'javascript:evil']]
    expect(residentGaMeasurementIds()).toEqual([])
  })

  it('is empty on the common pageview where the gate held the script out', () => {
    expect(residentGaMeasurementIds()).toEqual([])
    expect(analyticsProvider.resident()).toBe(false)
  })
})

describe('telling a resident tag the answer changed (AGL-1608)', () => {
  it('sets the disable flag and sends a consent update, both ways', () => {
    const calls: unknown[][] = []
    scope().gtag = (...args: unknown[]) => calls.push(args)
    scope().dataLayer = [['config', 'G-TEST1234']]

    expect(applyGoogleTagConsent({ analytics: false, advertising: false })).toEqual([
      'G-TEST1234',
    ])
    expect(scope()['ga-disable-G-TEST1234']).toBe(true)
    expect(calls).toEqual([
      [
        'consent',
        'update',
        {
          analytics_storage: 'denied',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
        },
      ],
    ])

    applyGoogleTagConsent({ analytics: true, advertising: true })
    expect(scope()['ga-disable-G-TEST1234']).toBe(false)
    expect(calls[1][2]).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
  })

  it('does nothing, and throws nothing, with no tag on the page', () => {
    expect(applyGoogleTagConsent({ analytics: false, advertising: false })).toEqual([])
  })
})

/**
 * Which DESTINATION an event is sent to (AGL-2710).
 *
 * A gtag event with no `send_to` reaches every destination the loader is
 * configured for. On `aglyn.com` that is the GA4 property AND the Google Ads
 * account, and one Core Web Vitals event was measured attempting seven
 * requests to `googleads.g.doubleclick.net` and `google.com/{pagead,rmkt,ccm}`.
 *
 * PLANTED REDS:
 *  1. Send `send_to` unconditionally, empty list included → the no-ids case
 *     goes red: a page whose tag came through GTM would lose the event.
 *  2. Read the ids once and keep them → the late-tag case goes red.
 */
describe('the event destination (AGL-2710)', () => {
  const calls: unknown[][] = []
  const mountGtagScript = (id: string) => {
    const script = document.createElement('script')
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
    document.head.appendChild(script)
  }
  beforeEach(() => {
    calls.length = 0
    scope().gtag = (...args: unknown[]) => calls.push(args)
  })

  it('names the resident GA4 property for a measurement-only event', () => {
    mountGtagScript('G-YW5PG16YTM')
    analyticsProvider.sendEvent('LCP', { value: 1 }, { measurementOnly: true })
    expect(calls).toEqual([
      ['event', 'LCP', { value: 1, send_to: ['G-YW5PG16YTM'] }],
    ])
  })

  it('does NOT name an ads account loaded beside it', () => {
    mountGtagScript('G-YW5PG16YTM')
    mountGtagScript('AW-18401436785')
    analyticsProvider.sendEvent('CLS', { value: 1 }, { measurementOnly: true })
    expect((calls[0][2] as Record<string, unknown>).send_to).toEqual([
      'G-YW5PG16YTM',
    ])
  })

  it('sends with NO send_to when no property can be named', () => {
    analyticsProvider.sendEvent('LCP', { value: 1 }, { measurementOnly: true })
    expect(calls[0][2]).not.toHaveProperty('send_to')
  })

  it('reads the ids when the event is sent, so a late tag is addressed', () => {
    analyticsProvider.sendEvent('TTFB', { value: 1 }, { measurementOnly: true })
    mountGtagScript('G-LATE1234')
    analyticsProvider.sendEvent('TTFB', { value: 2 }, { measurementOnly: true })
    expect((calls[1][2] as Record<string, unknown>).send_to).toEqual(['G-LATE1234'])
  })

  it('leaves an ordinary event unaddressed', () => {
    mountGtagScript('G-YW5PG16YTM')
    analyticsProvider.sendEvent('select_content', { surface: 'site' })
    expect(calls).toEqual([['event', 'select_content', { surface: 'site' }]])
  })
})

describe('the declaration core compiles (plugins.config.json)', () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, '../../../../../plugins.config.json'), 'utf8'),
  ) as { plugins: Array<{ id: string; analyticsProvider?: { module: string; settings: string[] } }> }
  const declared = config.plugins.find((plugin) => plugin.id === 'marketing')
    ?.analyticsProvider

  it('names this module', () => {
    expect(declared?.module).toBe('analytics-provider')
  })

  it('declares exactly the settings this adapter mounts a tag for', () => {
    // A setting declared and not mounted would ask visitors about a tag that
    // never loads; one mounted and not declared would load with no banner in
    // front of it.
    const mountsFor = (field: string) =>
      analyticsProvider.mounts(
        { analytics: { [field]: field === 'gaMeasurementId' ? 'G-TEST1234' : 'GTM-ABC1234' } },
        GRANTED,
      ).length > 0
    expect(declared?.settings).toEqual(['gaMeasurementId', 'gtmContainerId'])
    for (const field of declared?.settings ?? []) expect(mountsFor(field)).toBe(true)
  })
})
