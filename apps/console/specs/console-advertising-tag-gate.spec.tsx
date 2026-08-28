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
 * The console's advertising-tag gate, asserted on the SCRIPT ELEMENTS and on
 * the GLOBALS those elements define.
 *
 * A privacy control proven through a React prop is proven at the wrong layer:
 * the production question is whether `fbq`, `lintrk`'s partner-id array and a
 * second `gtag` product exist in the visitor's browser, so every case below
 * executes the boot snippet that was actually mounted and then asks the
 * window. A case that only counted elements would still pass if the snippet
 * emitted were empty.
 *
 * Each denial case sits beside a positive CONTROL that shares its setup, so a
 * fixture typo cannot make the whole suite green by mounting nothing anywhere.
 */
import { ADVERTISING_TAG_ATTRIBUTE } from '@aglyn/aglyn/app-utils/advertising-tags'
import {
  PLATFORM_CONSENT_SUBJECT,
  storePlatformConsent,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { visitorConsentStorageKey } from '@aglyn/aglyn/app-utils/visitor-consent'
import { act, render } from '@testing-library/react'
import PlatformAdvertisingTags from '../components/advertising-tags.component'

/**
 * `next/script` is inert in jsdom, so it is replaced — and the replacement has
 * to model two real behaviors, not one.
 *
 * **It renders a REAL `<script>` carrying every prop.** The teardown finds its
 * own elements by `script[data-aglyn-ad-tag="…"]` and by `src`; a double that
 * dropped either would let `revokeAdvertisingTags` find nothing and report
 * success, which is the shape of a check that cannot fail.
 *
 * **The element is NOT a React child.** `next/script` at `afterInteractive`
 * injects into the document itself and leaves the element there, which is the
 * entire reason the teardown removes it by hand (AGL-1608). Written as JSX,
 * React would own the node and its unmount would throw once the teardown had
 * already removed it — a failure that says nothing about production.
 */
jest.mock('next/script', () => {
  const react = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      const { children, strategy, src, id, ...rest } = props
      react.useEffect(() => {
        const doc = globalThis.document
        const element = doc.createElement('script')
        element.setAttribute('data-testid', String(id))
        for (const [key, value] of Object.entries(rest)) {
          if (typeof value === 'string') element.setAttribute(key, value)
        }
        // `setAttribute`, not `.src`: jsdom would resolve the property against
        // the test origin and the vendor URL would stop matching itself.
        if (src) element.setAttribute('src', String(src))
        if (children) element.textContent = String(children)
        doc.head.appendChild(element)
        return () => {
          if (element.parentNode) element.parentNode.removeChild(element)
        }
      }, [])
      return null
    },
  }
})

const PIXEL_ID = '1931535658229774'
const ADS_ID = 'AW-18401436785'
const PARTNER_ID = '9626898'
const CONTAINER_ID = 'GTM-N65S88G'

/** Every global a mounted boot can leave behind, cleared between cases. */
const VENDOR_GLOBALS = [
  'fbq',
  '_fbq',
  'gtag',
  'dataLayer',
  '_linkedin_partner_id',
  '_linkedin_data_partner_ids',
]

/** Every marked element, whatever the vendor. */
const adScripts = () =>
  Array.from(document.querySelectorAll(`script[${ADVERTISING_TAG_ATTRIBUTE}]`))

const vendorScripts = (vendorId: string) =>
  Array.from(
    document.querySelectorAll(
      `script[${ADVERTISING_TAG_ATTRIBUTE}="${vendorId}"]`,
    ),
  )

/** The library requests specifically — the things that reach a vendor host. */
const libraryHosts = () =>
  adScripts()
    .map((element) => element.getAttribute('src'))
    .filter((src): src is string => typeof src === 'string' && src !== '')

/**
 * Run every inline boot that was mounted, in document order, against the real
 * window — which is what the browser does with them.
 *
 * This is what turns an element count into an assertion about the visitor's
 * browser: after this, `window.fbq` either exists or it does not, and no
 * amount of correct-looking markup can fake it.
 */
function executeMountedBoots(): void {
  for (const element of adScripts()) {
    const text = element.textContent ?? ''
    if (!text) continue
    // `window.eval`, not `new Function`: a snippet's `function gtag(){…}` is a
    // GLOBAL declaration in a real <script> and a local one inside a function
    // body. Evaluating it anywhere but global scope would quietly prove the
    // wrong thing.
    ;(window as unknown as { eval: (code: string) => unknown }).eval(text)
  }
}

async function renderGate() {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(<PlatformAdvertisingTags />)
  })
  return result
}

/**
 * These cases describe a PRODUCTION deployment and have to say so (AGL-2067):
 * outside one `analyticsMayEmit()` is false and no tag is created at all,
 * which would make every negative case below pass for the wrong reason.
 */
const mutableEnv = process.env as Record<string, string | undefined>
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
  meta: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  ads: process.env.NEXT_PUBLIC_ADS_CONVERSION_ID,
  linkedin: process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID,
  gtm: process.env.NEXT_PUBLIC_GTM_CONTAINER_ID,
}

beforeEach(() => {
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
  process.env.NEXT_PUBLIC_META_PIXEL_ID = PIXEL_ID
  process.env.NEXT_PUBLIC_ADS_CONVERSION_ID = ADS_ID
  process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID = PARTNER_ID
  process.env.NEXT_PUBLIC_GTM_CONTAINER_ID = CONTAINER_ID
})

afterEach(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  for (const [name, value] of [
    ['NEXT_PUBLIC_DEPLOY_ENV', savedEnv.deployEnv],
    ['NEXT_PUBLIC_META_PIXEL_ID', savedEnv.meta],
    ['NEXT_PUBLIC_ADS_CONVERSION_ID', savedEnv.ads],
    ['NEXT_PUBLIC_LINKEDIN_PARTNER_ID', savedEnv.linkedin],
    ['NEXT_PUBLIC_GTM_CONTAINER_ID', savedEnv.gtm],
  ] as const) {
    if (value === undefined) delete mutableEnv[name]
    else mutableEnv[name] = value
  }
  window.localStorage.clear()
  window.sessionStorage.clear()
  // A global function declaration from an evaluated snippet is
  // non-configurable, so `delete` throws on it; assignment is what actually
  // clears it. Both are attempted because the plain assignments (`fbq`,
  // `_linkedin_partner_id`) are cleanest removed outright.
  for (const key of VENDOR_GLOBALS) {
    const scope = window as Record<string, any>
    try {
      delete scope[key]
    } catch {
      scope[key] = undefined
    }
  }
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
})

describe("the console's advertising-tag gate", () => {
  /**
   * THE CONTROL, first and deliberately. Every "nothing loads" case below is
   * only worth something because this one proves the same setup CAN produce
   * every tag — otherwise they would all be passing on a typo in the fixture.
   */
  describe('an explicit advertising grant — the state that loads', () => {
    it('mounts all four, reaches all four hosts, and defines the vendor globals', async () => {
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()

      // A PAIR per advertising vendor, plus the container's pair. Google Ads
      // shares `gtag.js`, and nothing else has mounted it in this document, so
      // it brings its own library here.
      expect(vendorScripts('meta')).toHaveLength(2)
      expect(vendorScripts('google-ads')).toHaveLength(2)
      expect(vendorScripts('linkedin')).toHaveLength(2)
      expect(vendorScripts('gtm')).toHaveLength(2)

      const hosts = libraryHosts()
      expect(hosts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('connect.facebook.net'),
          expect.stringContaining('googletagmanager.com/gtag/js'),
          expect.stringContaining('snap.licdn.com'),
          expect.stringContaining(`googletagmanager.com/gtm.js?id=${CONTAINER_ID}`),
        ]),
      )

      // The globals, which is the layer that actually matters.
      executeMountedBoots()
      const scope = window as Record<string, any>
      expect(typeof scope.fbq).toBe('function')
      expect(typeof scope.gtag).toBe('function')
      expect(scope._linkedin_partner_id).toBe(PARTNER_ID)
      expect(scope._linkedin_data_partner_ids).toContain(PARTNER_ID)
      expect(Array.isArray(scope.dataLayer)).toBe(true)
      // The container was told to start, which is the only thing a container
      // boot has to do.
      expect(JSON.stringify(scope.dataLayer)).toContain('gtm.js')
    })

    it("carries the configured ids into the snippets, not a vendor's default", async () => {
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      const boots = adScripts()
        .map((element) => element.textContent ?? '')
        .join('\n')
      expect(boots).toContain(`fbq('init', '${PIXEL_ID}')`)
      expect(boots).toContain(`gtag('config', '${ADS_ID}')`)
      expect(boots).toContain(`window._linkedin_partner_id='${PARTNER_ID}'`)
    })

    it('grants all three Consent Mode v2 advertising signals to the Ads tag', async () => {
      // Remarketing needs `ad_storage`, `ad_user_data` AND `ad_personalization`.
      // A tag that is loaded and sending hits with the other two denied
      // collects nothing into an audience while looking healthy in GA4.
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      const boot = vendorScripts('google-ads')
        .map((element) => element.textContent ?? '')
        .join('')
      expect(boot).toContain("ad_storage:'granted'")
      expect(boot).toContain("ad_user_data:'granted'")
      expect(boot).toContain("ad_personalization:'granted'")
      // And nothing switches personalized remarketing off behind the signals.
      expect(boot).not.toContain('allow_ad_personalization_signals')
    })
  })

  describe('every state that must load nothing', () => {
    it('mounts nothing before the visitor has been resolved', async () => {
      // No record at all: the resolution has not finished, or the visitor is
      // in a prior-consent region and has not answered. Undecided is not a
      // grant, and the gate never has to ask which of the two it is.
      await renderGate()
      expect(adScripts()).toHaveLength(0)
      executeMountedBoots()
      expect((window as Record<string, any>).fbq).toBeUndefined()
      expect((window as Record<string, any>)._linkedin_partner_id).toBeUndefined()
    })

    it.each([
      ['declined', 'declined'],
      ['opted-out', 'opted-out'],
      ['gpc-opt-out', 'gpc-opt-out'],
    ])('mounts nothing for a %s visitor', async (_label, status) => {
      storePlatformConsent({
        status: status as any,
        country: 'US',
        advertising: true,
      })
      // The writer re-derives the grant from the status, so a refusal cannot
      // carry an advertising yes however the caller asked for one.
      await renderGate()
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      expect(vendorScripts('google-ads')).toHaveLength(0)
      executeMountedBoots()
      expect((window as Record<string, any>).fbq).toBeUndefined()
    })

    it('mounts the analytics-gated container but no vendor for an analytics-only grant', async () => {
      // Withdrawing advertising alone is a real state: the container rides
      // the analytics grant, the vendor tags do not.
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: false,
      })
      await renderGate()
      expect(vendorScripts('gtm')).toHaveLength(2)
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      executeMountedBoots()
      expect((window as Record<string, any>).fbq).toBeUndefined()
      expect(
        (window as Record<string, any>)._linkedin_partner_id,
      ).toBeUndefined()
    })

    it('mounts nothing on a preview deployment, however granting the record', async () => {
      process.env.NEXT_PUBLIC_DEPLOY_ENV = 'preview'
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      expect(adScripts()).toHaveLength(0)
    })

    it('mounts nothing for a vendor whose id this build does not configure', async () => {
      delete mutableEnv.NEXT_PUBLIC_META_PIXEL_ID
      delete mutableEnv.NEXT_PUBLIC_LINKEDIN_PARTNER_ID
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      // The control inside the case: Google Ads is still configured, so this
      // is an absent id rather than an absent grant.
      expect(vendorScripts('google-ads')).toHaveLength(2)
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
    })

    it('mounts no container for a malformed or absent container id', async () => {
      process.env.NEXT_PUBLIC_GTM_CONTAINER_ID = 'GTM-not a container'
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      expect(vendorScripts('gtm')).toHaveLength(0)
      // The control: the vendor tags still mounted, so this is the container's
      // format check and not a collapsed gate.
      expect(vendorScripts('meta')).toHaveLength(2)
    })

    it('mounts nothing for a malformed id rather than injecting it', async () => {
      process.env.NEXT_PUBLIC_META_PIXEL_ID = "12345678'));alert(1)//"
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(2)
    })
  })

  describe('withdrawal inside one pageview', () => {
    it('revokes, removes and sweeps when the visitor turns advertising off', async () => {
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate()
      expect(vendorScripts('meta')).toHaveLength(2)

      // The vendor library has EXECUTED and written its identifiers, which is
      // the state a render-time gate cannot undo on its own.
      const calls: unknown[][] = []
      ;(window as Record<string, any>).fbq = (...args: unknown[]) => {
        calls.push(args)
      }
      document.cookie = '_fbp=fb.1.test; path=/'
      document.cookie = '_fbc=fb.1.click; path=/'
      expect(document.cookie).toContain('_fbp=')

      await act(async () => {
        storePlatformConsent({
          status: 'opted-out',
          country: 'US',
          advertising: false,
        })
      })

      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      expect(calls).toContainEqual(['consent', 'revoke'])
      expect(document.cookie).not.toContain('_fbp=')
      expect(document.cookie).not.toContain('_fbc=')
    })

    it('mirrors the record at the registrable domain, which is what docs reads', async () => {
      // The docs site has no resolver of its own; the mirror IS its gate. A
      // console decision that never left this origin would leave that surface
      // permanently silent, and the failure would look like a docs bug.
      storePlatformConsent({
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      const raw = window.localStorage.getItem(
        visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT),
      )
      expect(JSON.parse(raw ?? 'null')?.advertising).toBe(true)
    })
  })
})
