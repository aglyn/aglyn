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
 * @jest-environment-options {"url": "https://aglyn.com/"}
 */

/**
 * The vendor-agnostic advertising-tag gate, asserted where the GA
 * gate is asserted: on the SCRIPT ELEMENTS. A privacy control that is only
 * proven through a boolean is proven at the wrong layer — the production
 * question is whether the vendor's script is in the document, so that is the
 * question every case below asks.
 *
 * Each case names the ONE thing whose removal turns it red, and each was run
 * red on purpose before it was run green. The repo has shipped vacuous
 * assertions before (`null === null`, `[].every()` over an empty array), so
 * every positive case asserts NON-EMPTINESS before it asserts a property, and
 * the negative cases sit beside a positive control that shares their setup.
 */
import {
  ADVERTISING_TAG_ATTRIBUTE,
  ADVERTISING_VENDORS,
  GOOGLE_ADS_VENDOR,
  META_PIXEL_VENDOR,
  resolveAdvertisingTags,
  revokeAdvertisingTags,
} from '@aglyn/aglyn/app-utils/advertising-tags'
import { analyticsMayEmit } from '@aglyn/aglyn/app-utils/analytics-environment'
import {
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
} from '@aglyn/aglyn/app-utils/internal-traffic'
import { PLATFORM_GA_MEASUREMENT_ID } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import {
  storeVisitorConsent,
  visitorConsentStorageKey,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { act, render } from '@testing-library/react'
import AdvertisingTags from '../app/[host]/[[...slug]]/advertising-tags'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `next/script` is inert in jsdom, so it is replaced — and the replacement has
 * to model two real behaviours, not one.
 *
 * **It renders a REAL `<script>` carrying every prop.** The teardown finds its
 * own elements by `script[data-aglyn-ad-tag="…"]` and by `src`; a double that
 * dropped either would let `revokeAdvertisingTags` find nothing and report
 * success, which is the shape of a check that cannot fail.
 *
 * **The element is NOT a React child.** `next/script` at `afterInteractive`
 * injects into the document itself and leaves the element there — which is the
 * entire reason `revokeAdvertisingTags` has to remove it by hand (AGL-1608).
 * Written the obvious way, as JSX returned from this component, React owns the
 * node and its unmount throws `NotFoundError` once the teardown has removed
 * it — a failure that says nothing about production and hides the case it was
 * written to prove. So the double appends imperatively and removes only what
 * is still attached, exactly as the real one behaves.
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

const HOST_ID = 'ad-gate-host'
const PIXEL_ID = '1234567890123456'

/** Aglyn's own marketing site, configured exactly as deployment would. */
const OUR_HOST = {
  $id: HOST_ID,
  analytics: {
    gaMeasurementId: PLATFORM_GA_MEASUREMENT_ID,
    adTags: { meta: PIXEL_ID },
  },
  consent: { advertising: true },
}

/** A customer's site, identical in every way except whose property it is. */
const CUSTOMER_HOST = {
  ...OUR_HOST,
  $id: 'customer-host',
  analytics: { gaMeasurementId: 'G-CUST1234', adTags: { meta: PIXEL_ID } },
}

/** Every element the gate is answerable for, by the selector it uses live. */
const vendorScripts = () =>
  Array.from(
    document.querySelectorAll(
      `script[${ADVERTISING_TAG_ATTRIBUTE}="${META_PIXEL_VENDOR.id}"]`,
    ),
  )

/** The library request specifically — the thing that reaches Meta. */
const vendorLibrary = () =>
  vendorScripts().filter((element) =>
    String((element as HTMLScriptElement).getAttribute('src') ?? '').includes(
      META_PIXEL_VENDOR.scriptMatch,
    ),
  )

async function renderGate(host: Record<string, any>, hostId = HOST_ID) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <AdvertisingTags
        host={host as any}
        stored={JSON.parse(
          window.localStorage.getItem(visitorConsentStorageKey(hostId)) ??
            'null',
        )}
        ready
      />,
    )
  })
  return result
}

/**
 * These cases describe a PRODUCTION deployment and have to say so (AGL-2067):
 * outside one `analyticsMayEmit()` is false and no tag is created at all,
 * which would make every negative case below pass for the wrong reason.
 * Declared per file rather than in a jest setup, for the reason
 * `ga-consent-gate.spec.tsx` gives: `NODE_ENV` moves far more than analytics.
 */
const mutableEnv = process.env as Record<string, string | undefined>
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
/**
 * A production deployment is also a real HOSTNAME, which is why this file's
 * first docblock names a document URL (AGL-2067). jsdom serves every spec from
 * `localhost`, and `analyticsMayEmit` reads a loopback host as a machine
 * talking to itself — it stays silent however the variables below are set, so
 * the two halves only describe a deployment together.
 *
 * The pragma counts only in the FIRST docblock of the file. jest reads no
 * other one, and ignores a later one without saying so.
 */
beforeAll(() => {
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) {
    delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  } else {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
  }
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (navigator as Record<string, any>)['globalPrivacyControl']
  delete (window as Record<string, any>)['fbq']
  delete (window as Record<string, any>)['_fbq']
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
})

describe('the advertising-tag gate', () => {
  /**
   * The positive control, first and deliberately. Every "nothing loads" case
   * below is only worth something because this one proves the same setup CAN
   * produce a tag — otherwise they would all be passing on a typo in the
   * fixture.
   */
  describe('explicit advertising acceptance — the one state that loads', () => {
    it('renders the vendor pair, with the library URL and the pixel id', async () => {
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate(OUR_HOST)

      // Non-emptiness BEFORE any property of the elements.
      expect(vendorScripts().length).toBe(2)
      expect(vendorLibrary().length).toBe(1)
      expect(
        vendorLibrary()[0].getAttribute('src'),
      ).toBe(META_PIXEL_VENDOR.scriptSrc)

      const boot = vendorScripts()
        .map((element) => element.textContent ?? '')
        .join('')
      expect(boot).toContain(`fbq('init', '${PIXEL_ID}')`)
      // The explicit grant precedes init, so nothing the library later drains
      // was queued under a state nobody chose.
      expect(boot.indexOf("fbq('consent', 'grant')")).toBeGreaterThan(-1)
      expect(boot.indexOf("fbq('consent', 'grant')")).toBeLessThan(
        boot.indexOf("fbq('init'"),
      )
    })
  })

  describe('no vendor script exists without an advertising grant', () => {
    it('(a) an IMPLIED-consent visitor — the US default — NOW gets the tags', async () => {
      // ⚑ This case has flipped twice; read the history before flipping it a
      // third time. AGL-2402 granted, 2026-08-24 narrowed back (the published
      // Cookie Policy still said advertising cookies were "set only where you
      // have allowed"), 2026-08-25 restored once BOTH legal masters agreed —
      // the Privacy Policy already described the opt-out posture and the
      // Cookie Policy's five opt-in-only sentences were rewritten that day.
      //
      // `OUR_HOST` DOES ask about advertising (`consent: { advertising: true
      // }`) and `advertising: true` is passed IN, so this asserts the full
      // chain: the status rule permits it, the host asked, the caller asked,
      // and the vendor script actually reaches the DOM.
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'implied',
        country: 'US',
        advertising: true,
      })
      expect(stored.analytics).toBe(true)
      // The re-derivation, asserted before the render so a failure here says
      // "the engine refused it" rather than "the DOM was empty".
      expect(stored.advertising).toBe(true)

      await renderGate(OUR_HOST)
      expect(vendorScripts().length).toBeGreaterThan(0)
    })

    it('(a1) …but NOT on a host that never asked about advertising', async () => {
      // The other half of the widened rule, and the one that keeps it from
      // becoming "implied means yes everywhere". The status now permits a
      // grant, so `hostAsksAboutAdvertising` is what is left holding the line
      // for a Host whose owner never turned the question on. Same `$id` as the
      // stored record, so the ONLY difference from case (a) is `consent`.
      const NEVER_ASKED = { ...OUR_HOST, consent: {} }
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'implied',
        country: 'US',
        advertising: true,
      })
      // The record itself still says no, because `hostAsksAboutAdvertising` is
      // re-checked at read time and this host does not ask.
      expect(stored.analytics).toBe(true)

      await renderGate(NEVER_ASKED)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('(a2) …and not when the stored record claims otherwise', async () => {
      // Hand-edited records, written straight to localStorage so nothing
      // sanitises them on the way in. The engine re-derives the grant against
      // the STATUS on every read, so the gate's answer must not depend on the
      // file on disk being honest. ⚑ `implied` LEFT this list on 2026-08-25 —
      // it is a real basis now; these are the statuses that must ALWAYS refuse
      // however the record is doctored.
      for (const status of ['declined', 'opted-out', 'gpc-opt-out']) {
        window.localStorage.setItem(
          visitorConsentStorageKey(HOST_ID),
          JSON.stringify({
            v: 1,
            at: Date.now(),
            status,
            analytics: true,
            advertising: true,
            country: 'US',
          }),
        )
        await renderGate(OUR_HOST)
        expect({ status, scripts: vendorScripts().length }).toEqual({
          status,
          scripts: 0,
        })
      }
    })

    it('(b) a GPC visitor gets nothing', async () => {
      ;(navigator as Record<string, any>)['globalPrivacyControl'] = true
      storeVisitorConsent(HOST_ID, {
        status: 'gpc-opt-out',
        country: 'US',
        advertising: true,
      })
      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('(c) an EEA visitor pre-choice gets nothing — there is no record yet', async () => {
      // Undecided is not a maybe. No record is written for an opt-in posture
      // until the visitor clicks, so this is the state an EEA/UK visitor is in
      // for the whole of a pageview they never answer.
      expect(
        window.localStorage.getItem(visitorConsentStorageKey(HOST_ID)),
      ).toBeNull()
      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('an explicit DECLINE gets nothing', async () => {
      storeVisitorConsent(HOST_ID, { status: 'declined', country: 'DE' })
      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('accepting ANALYTICS while refusing advertising gets nothing', async () => {
      // The Preferences panel's "analytics yes, advertising no" outcome — an
      // `accepted` status, which DOES carry an advertising grant in general.
      // Only the per-category answer separates this from the positive control.
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: false,
      })
      expect(stored.analytics).toBe(true)
      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('a host that never turned the advertising QUESTION on gets nothing', async () => {
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate({ ...OUR_HOST, consent: {} })
      expect(vendorScripts()).toHaveLength(0)
    })

    it('a host running its own CMP (consent.disabled) gets nothing', async () => {
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate({
        ...OUR_HOST,
        consent: { advertising: true, disabled: true },
      })
      expect(vendorScripts()).toHaveLength(0)
    })
  })

  describe('(f) surface scope: our marketing site and nothing else', () => {
    it("a CUSTOMER's tenant host gets nothing, even fully configured", async () => {
      // Identical consent record, identical pixel id, identical host shape.
      // The ONLY difference from the positive control is whose GA property
      // the site reports to — which is the discriminator, so this is the
      // narrowest possible test of it.
      storeVisitorConsent('customer-host', {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate(CUSTOMER_HOST, 'customer-host')
      expect(vendorScripts()).toHaveLength(0)
    })

    it('and the pure verdict agrees, with the ONLY difference being the property', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      expect(resolveAdvertisingTags(OUR_HOST as any, stored)).toHaveLength(1)
      expect(
        resolveAdvertisingTags(
          { ...OUR_HOST, analytics: { ...OUR_HOST.analytics, gaMeasurementId: 'G-CUST1234' } } as any,
          stored,
        ),
      ).toHaveLength(0)
    })

    it('a NON-PRODUCTION build gets nothing, even on our own host', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      // Positive control in the same breath, so a broken fixture cannot make
      // the preview case pass.
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, {
          nodeEnv: 'production',
          deployEnv: 'production',
        }),
      ).toHaveLength(1)
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, {
          nodeEnv: 'production',
          deployEnv: 'preview',
        }),
      ).toHaveLength(0)
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, {
          nodeEnv: 'development',
          deployEnv: '',
        }),
      ).toHaveLength(0)
    })

    it('nothing loads for an unconfigured host — the state of the repo today', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      const { adTags, ...analytics } = OUR_HOST.analytics as any
      expect(adTags).toBeTruthy()
      expect(
        resolveAdvertisingTags({ ...OUR_HOST, analytics } as any, stored),
      ).toHaveLength(0)
    })

    it('a malformed pixel id is not a pixel id', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      for (const bad of ['', '123', "1'); alert(1);//", 'abcdefghij']) {
        expect(
          resolveAdvertisingTags(
            {
              ...OUR_HOST,
              analytics: { ...OUR_HOST.analytics, adTags: { meta: bad } },
            } as any,
            stored,
          ),
        ).toHaveLength(0)
      }
    })
  })

  describe('(h) a browser we have declared OURS gets no advertising tag', () => {
    /*
     * The GA4 data filter cannot do this job, and believing it does is the
     * trap. That filter is PROPERTY-scoped: it drops `traffic_type: internal`
     * hits from the GA4 property, and Google Ads, Meta and LinkedIn are
     * separate products reached by separate requests it never sees.
     *
     * Measured on aglyn.com 2026-09-01: a flagged browser's pageview is
     * correctly absent from GA4 while the SAME pageview still sends
     * `ccm/collect`, `pagead/1p-user-list` (`is_vtc=1`) and
     * `viewthroughconversion` to `AW-18401436785`. Excluding ourselves from
     * the reports while still training the remarketing audiences is the worse
     * half, because it is the half no report can show.
     */
    it('the pure verdict refuses, and the SAME inputs load without the flag', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      const production = {
        nodeEnv: 'production',
        deployEnv: 'production',
      } as const
      // Both directions off ONE fixture, so neither can pass on a typo in the
      // other's setup — a gate exercised one way only is the shape that ships
      // broken.
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, production, false),
      ).toHaveLength(1)
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, production, true),
      ).toHaveLength(0)
    })

    it('refuses the GOOGLE ADS vendor too — the one actually deployed', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      const production = {
        nodeEnv: 'production',
        deployEnv: 'production',
      } as const
      // The live id, so this case is the deployment and not a near-miss.
      const host = {
        ...OUR_HOST,
        analytics: {
          ...OUR_HOST.analytics,
          adTags: { [GOOGLE_ADS_VENDOR.id]: 'AW-18401436785' },
        },
      }
      expect(
        resolveAdvertisingTags(host as any, stored, production, false),
      ).toHaveLength(1)
      expect(
        resolveAdvertisingTags(host as any, stored, production, true),
      ).toHaveLength(0)
    })

    /*
     * The escape hatch is the other half. `analyticsMayEmit` PASSES under it,
     * so before this clause a `next dev` or preview build with the hatch on
     * would have loaded the real `AW-` id and built remarketing audiences out
     * of our own engineers — the exact hole condition 2 exists to close,
     * reopened by the thing standing beside it.
     */
    it('the non-production escape hatch does not reopen condition 2', () => {
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      // The hatch on a development build: `analyticsMayEmit` is true here, so
      // this case reaches condition 6 and nothing earlier can be what stops it.
      const hatched = {
        nodeEnv: 'development',
        deployEnv: 'development',
        allowNonProduction: '1',
      } as const
      expect(analyticsMayEmit(hatched)).toBe(true)
      expect(
        resolveAdvertisingTags(OUR_HOST as any, stored, hatched, false),
      ).toHaveLength(0)
      // Production with the same un-flagged browser still loads, so the clause
      // above is the hatch and not a blanket refusal.
      expect(
        resolveAdvertisingTags(
          OUR_HOST as any,
          stored,
          { nodeEnv: 'production', deployEnv: 'production' },
          false,
        ),
      ).toHaveLength(1)
    })

    /*
     * The WIRE, not the verdict. The test above would keep passing if the
     * component never consulted the browser at all — it passes the flag in by
     * hand. This one sets only what a real flagged browser has and renders the
     * real component, so it fails if the default argument is dropped.
     */
    it('and the COMPONENT reads the flag itself, with no tag reaching the document', async () => {
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })

      // Positive control in the same test: this fixture DOES produce a tag.
      const granted = await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(2)

      // Unmount to take the control's own elements back out, so the assertion
      // below is about the second render and not about cleanup.
      granted.unmount()
      expect(vendorScripts()).toHaveLength(0)

      window.localStorage.setItem(
        INTERNAL_TRAFFIC_STORAGE_KEY,
        INTERNAL_TRAFFIC_VALUE,
      )
      const flagged = await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)

      // And back, so the zero above is attributable to the FLAG and not to
      // some once-per-file state that would make any second render empty.
      flagged.unmount()
      window.localStorage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(2)
    })
  })

  describe('(e) withdrawal stops it inside the same pageview', () => {
    it('removes the scripts, revokes on the resident tag, and deletes _fbp/_fbc', async () => {
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate(OUR_HOST)
      // The tag really is there before the withdrawal — without this the
      // assertions below would hold on a page that never loaded anything.
      expect(vendorLibrary().length).toBe(1)

      // The vendor library has EXECUTED: `fbq` exists and has written its
      // first-party identifiers. This is the AGL-1608 state the render gate
      // cannot reach on its own.
      const calls: unknown[][] = []
      ;(window as Record<string, any>)['fbq'] = (...args: unknown[]) =>
        calls.push(args)
      document.cookie = `_fbp=fb.1.${Date.now()}.99; path=/`
      document.cookie = `_fbc=fb.1.${Date.now()}.click; path=/`
      expect(document.cookie).toContain('_fbp=')
      expect(document.cookie).toContain('_fbc=')

      // The visitor opens "Your Privacy Choices" and turns advertising off.
      // Recorded exactly as the panel records it, so the event that drives the
      // teardown is the real one.
      await act(async () => {
        storeVisitorConsent(HOST_ID, {
          status: 'opted-out',
          country: 'US',
          advertising: false,
        })
      })

      expect(vendorScripts()).toHaveLength(0)
      expect(calls).toContainEqual(['consent', 'revoke'])
      expect(document.cookie).not.toContain('_fbp=')
      expect(document.cookie).not.toContain('_fbc=')
    })

    it('revoke reaches the tag BEFORE the cookies are swept', async () => {
      // Order is the whole of AGL-1608: sweeping first deletes the cookies and
      // the resident pixel's next automatic event writes them straight back.
      storeVisitorConsent(HOST_ID, {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate(OUR_HOST)
      expect(vendorLibrary().length).toBe(1)

      const order: string[] = []
      document.cookie = `_fbp=fb.1.${Date.now()}.99; path=/`
      ;(window as Record<string, any>)['fbq'] = () => {
        order.push(`revoked:${document.cookie.includes('_fbp=')}`)
      }
      await act(async () => {
        storeVisitorConsent(HOST_ID, { status: 'opted-out', country: 'US' })
      })
      // The cookie was still present when the revoke landed.
      expect(order).toEqual(['revoked:true'])
      expect(document.cookie).not.toContain('_fbp=')
    })

    it("does NOT touch a pixel we did not load — a customer's own Custom HTML", async () => {
      // A hand-pasted Meta pixel: same vendor, same URL, no marker of ours.
      // Killing it would be us configuring a customer's site under a consent
      // record that is not the basis their tag runs on.
      const theirs = document.createElement('script')
      theirs.setAttribute('src', META_PIXEL_VENDOR.scriptSrc)
      theirs.setAttribute('data-theirs', '')
      document.body.appendChild(theirs)
      document.cookie = `_fbp=fb.1.${Date.now()}.theirs; path=/`
      expect(document.querySelectorAll('script[data-theirs]')).toHaveLength(1)

      // Called DIRECTLY, not through the component. On a customer host the
      // component installs no listener at all (asserted separately below), so
      // driving this through the UI would prove the attribute scope by never
      // exercising it — green because nothing ran. The attribute scope is a
      // property of the teardown itself, so it is asked of the teardown
      // itself, in the state where it would do damage if it were absent.
      expect(revokeAdvertisingTags()).toEqual([])

      expect(document.querySelectorAll('script[data-theirs]')).toHaveLength(1)
      expect(document.cookie).toContain('_fbp=')
      theirs.remove()
    })

    it('installs NO withdrawal listener on a customer host', async () => {
      // The second, independent scope. Even a marked element — which cannot
      // legitimately exist on a customer site — is untouched, because a
      // withdrawal recorded there never reaches this component's teardown.
      storeVisitorConsent('customer-host', {
        status: 'accepted',
        country: 'US',
        advertising: true,
      })
      await renderGate(CUSTOMER_HOST, 'customer-host')

      const planted = document.createElement('script')
      planted.setAttribute('src', META_PIXEL_VENDOR.scriptSrc)
      planted.setAttribute(ADVERTISING_TAG_ATTRIBUTE, META_PIXEL_VENDOR.id)
      document.head.appendChild(planted)
      // The plant really is the shape the teardown acts on — without this the
      // survival below would prove nothing about the listener.
      expect(vendorScripts()).toHaveLength(1)

      await act(async () => {
        storeVisitorConsent('customer-host', {
          status: 'opted-out',
          country: 'US',
        })
      })

      expect(vendorScripts()).toHaveLength(1)
      planted.remove()
    })
  })
  /**
   * The console half of (f): the vendor reaches the console through ONE
   * reviewed file and no other.
   *
   * ## What this case used to assert, and why it changed
   *
   * That the console had no mount point at all. It now has one —
   * `apps/console/components/advertising-tags.component.tsx`, mounted from
   * `providers.tsx` and gated on `platformAdvertisingAllowed()`, the console's
   * own consent resolver. Aglyn advertises on its own surfaces and the Privacy
   * Policy names the console among them.
   *
   * ## What did NOT change, and is the reason this case survives
   *
   * Aglyn's DPA §3.2 promises customers we do not "sell"/"share **Customer**
   * Personal Data" — the data a customer's site collects about THEIR visitors,
   * which Aglyn processes as a processor. A console visitor is Aglyn's own
   * user, and Aglyn is the controller for their data; those are different
   * relationships and always were. The boundary the DPA draws is enforced
   * elsewhere in this file and is untouched: `resolveAdvertisingTags` refuses
   * any host that is not the platform marketing host, so a customer's
   * published site still mounts nothing.
   *
   * ⚠️ Being permitted is not the same as being small. A pixel on a SIGNED-IN
   * console reports an identified account holder's movement through a product,
   * which is a heavier disclosure than a marketing pageview — that is why the
   * mount is confined to one named file rather than allowed to spread, and why
   * `subprocessor-inventory.ts` says so in as many words.
   *
   * So the scan below is unchanged in kind: it still fires on any console file
   * that imports the vendor module or calls `fbq(`. What moved is that exactly
   * one file is now expected to, and it is named.
   */
  describe('(f) the console reaches the vendor through one reviewed file', () => {
    const consoleSources = () => {
      const listed = execFileSync(
        'git',
        ['ls-files', 'apps/console'],
        { cwd: resolve(__dirname, '../../..'), encoding: 'utf8' },
      )
        .split('\n')
        .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file))
      return listed.map((file) => ({
        file,
        source: readFileSync(
          resolve(__dirname, '../../..', file),
          'utf8',
        ),
      }))
    }

    it('only the one console mount imports the advertising gate or names the vendor', () => {
      const files = consoleSources()
      // The scan found the app it is meant to police. Without this the loop
      // below is `[].every()` — green over nothing, the exact vacuous shape
      // this repo has shipped before.
      expect(files.length).toBeGreaterThan(200)
      expect(files.some((f) => f.file.endsWith('constants/cookie-inventory.ts')))
        .toBe(true)

      // Comments are STRIPPED before the scan (AGL-2486). This guard is about
      // an import, not about a word: `apps/console/constants/cookie-inventory.ts`
      // has a docstring explaining why the coverage check lives in THIS file
      // and not there, and that explanation necessarily names
      // `app-utils/advertising-tags` — so the substring scan read the reason
      // for the rule as a violation of it, and turned this case red on `main`
      // for every hourly Main Gate sweep. A comment cannot load a pixel.
      //
      // The stripping is deliberately crude and that is the safe direction: it
      // removes `//` lines and `/* … */` blocks, so the worst it can do is
      // fail to strip something and go red, never strip real code and go
      // green. A string literal containing `//` survives, which is fine —
      // nothing here needs one.
      const withoutComments = (source: string) =>
        source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      // Files whose PURPOSE is to disclose the vendor (AGL-1648). The
      // subprocessor registry names `connect.facebook.net` and the
      // advertising-tags module path inside STRING LITERALS — prose, which
      // survives comment-stripping — because naming what it discloses is the
      // entire point of a disclosure registry. Measured: 2 occurrences of the
      // script host, 1 of the module path, and ZERO of `fbq`.
      //
      // This is a classification, not a hole. The executable signals below are
      // still checked for these files; only the bare substring is exempted. And
      // the registry is imported by nothing but its own spec, so it cannot load
      // anything even if it wanted to.
      const DISCLOSURE_ONLY = new Set([
        'apps/console/constants/subprocessor-inventory.ts',
      ])

      /**
       * The console's ONE advertising mount, and its spec.
       *
       * Exempted by NAME rather than by pattern, which is the whole of the
       * remaining guard: any second console file that imports the vendor
       * module or calls `fbq(` is still an offender, so the pixel cannot
       * spread from here into arbitrary console code without turning this
       * red. The assertion below proves each of these paths still exists and
       * still trips the scan, so an entry cannot outlive the file it names.
       */
      const CONSOLE_AD_MOUNT = new Set([
        'apps/console/components/advertising-tags.component.tsx',
        'apps/console/specs/console-advertising-tag-gate.spec.tsx',
        'apps/console/specs/docs-advertising-tags.spec.ts',
      ])

      // Files that name the advertising-tags module path as DATA — an element
      // of a list of files to READ — rather than as code (AGL-1649).
      //
      // A path handed to `readFileSync` never enters the module graph, so it
      // cannot load a pixel; it is the same class of mention as the disclosure
      // registry above, arriving for a different reason, and it gets its own
      // set because the comment on that one describes a disclosure registry and
      // a copy-drift audit is not one. A Map, not a Set, because an exemption
      // whose REASON is not written down is the thing that gets copied by the
      // next person who wants a red to go away.
      const COPY_AUDIT_ONLY = new Map<string, string>([
        [
          'apps/console/specs/consent-advertising-copy-drift.spec.ts',
          'Lists every surface whose consent COPY must not contradict the ' +
            'implied-mode rule, and reads each one as text to diff the prose ' +
            '(AGL-1649). `advertising-tags.ts` is one of those surfaces, so the ' +
            'path appears once, inside the `SURFACES` array, and is passed to ' +
            '`readFileSync`. Measured: 1 occurrence of the module path, ZERO of ' +
            'the script host, ZERO of `fbq`. Its only advertising-adjacent ' +
            'import is `visitor-consent`, which is the consent verdict and not ' +
            'the tag.',
        ],
      ])

      // Executable use — an actual import, or an actual call. Applies to EVERY
      // file including the disclosure ones, so a real pixel added to the
      // registry tomorrow still turns this red.
      const executesTheVendor = (code: string) =>
        /(?:from|import|require)\s*\(?\s*['"][^'"]*app-utils\/advertising-tags/.test(
          code,
        ) || /\bfbq\s*\(/.test(code)

      const offenders = files.filter(({ file, source }) => {
        // The named mount is allowed to do both — it is the mount. Checked
        // FIRST, unlike the two sets below, because those are exemptions from
        // a substring scan while this is an exemption from the executable one.
        if (CONSOLE_AD_MOUNT.has(file)) return false
        const code = withoutComments(source)
        if (executesTheVendor(code)) return true
        if (DISCLOSURE_ONLY.has(file) || COPY_AUDIT_ONLY.has(file)) return false
        return (
          code.includes('app-utils/advertising-tags') ||
          code.includes(META_PIXEL_VENDOR.scriptMatch) ||
          /\bfbq\b/.test(code)
        )
      })
      expect(offenders.map((f) => f.file)).toEqual([])

      // Every named mount still EXISTS and still executes the vendor. An
      // exemption whose file has been deleted or has stopped importing the
      // module is a standing permission nobody is reading any more — and here
      // it would also mean the console had silently stopped mounting the tags
      // it is supposed to mount.
      for (const file of CONSOLE_AD_MOUNT) {
        const entry = files.find((f) => f.file === file)
        expect([file, Boolean(entry)]).toEqual([file, true])
        expect([
          file,
          executesTheVendor(withoutComments(entry.source)),
        ]).toEqual([file, true])
      }

      // The mount is CONSENT-GATED, which is the property the exemption is
      // worth granting for. A mount that stopped asking the console's resolver
      // would pass every scan above and load a pixel for a visitor who
      // refused.
      const mount = files.find(
        (f) => f.file === 'apps/console/components/advertising-tags.component.tsx',
      )
      expect(mount.source).toContain('platformAdvertisingAllowed')
      expect(mount.source).toContain('resolvePlatformAdvertisingTags')

      // The exemption must not be able to rot into a blanket pass: prove the
      // allowlisted file is still caught when it genuinely executes the vendor.
      expect(
        executesTheVendor("import { x } from '../app-utils/advertising-tags'"),
      ).toBe(true)
      expect(executesTheVendor('fbq("track", "PageView")')).toBe(true)
      expect(executesTheVendor('"we disclose connect.facebook.net"')).toBe(false)

      // The ordering above is the property that makes an exemption safe:
      // `executesTheVendor` runs BEFORE the allowlist short-circuit, so an
      // exempted file that starts importing the module is still an offender.
      // Proved against the real allowlisted paths rather than a synthetic
      // string, so a refactor that reorders those two lines fails here.
      const exempt = [...DISCLOSURE_ONLY, ...COPY_AUDIT_ONLY.keys()]
      for (const file of exempt) {
        const wouldExecute = `import { metaPixel } from '@aglyn/aglyn/app-utils/advertising-tags'`
        expect([
          file,
          [{ file, source: wouldExecute }].filter(({ file: f, source }) => {
            const code = withoutComments(source)
            if (executesTheVendor(code)) return true
            if (DISCLOSURE_ONLY.has(f) || COPY_AUDIT_ONLY.has(f)) return false
            return true
          }).length,
        ]).toEqual([file, 1])
      }

      // An exemption must not outlive the mention that earned it. Every
      // allowlisted path must still be scanned AND still trip the substring
      // scan — otherwise the entry is dead, and a dead entry is a standing
      // permission nobody is reading any more.
      for (const file of exempt) {
        const entry = files.find((f) => f.file === file)
        expect([file, Boolean(entry)]).toEqual([file, true])
        const code = withoutComments(entry.source)
        expect([
          file,
          code.includes('app-utils/advertising-tags') ||
            code.includes(META_PIXEL_VENDOR.scriptMatch) ||
            /\bfbq\b/.test(code),
        ]).toEqual([file, true])
      }

      // And every reason is real prose, not a placeholder.
      for (const [file, reason] of COPY_AUDIT_ONLY) {
        expect([file, reason.length > 80]).toEqual([file, true])
      }
    })

    it('and the gate is mounted from exactly one place — the tenant route', () => {
      const root = resolve(__dirname, '../../..')
      const mounts = execFileSync(
        'git',
        // `:!*.spec.*` excludes THIS file. `git grep` searches only TRACKED
        // files, so while the spec was new-and-untracked it matched nothing and
        // this guard passed — then went red the moment it was committed. Scope
        // is about production mount points, not the test that polices them.
        [
          'grep',
          '-l',
          '-e',
          '<AdvertisingTags',
          '--',
          'apps',
          'libs',
          ':!*.spec.*',
        ],
        { cwd: root, encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean)
      // Non-emptiness first: a grep that found nothing would "prove" scope by
      // proving the feature does not exist.
      expect(mounts).toEqual(['apps/tenant/app/[host]/[[...slug]]/site-analytics.tsx'])
    })

    it('and the shared mount is used by exactly the surfaces that have a resolver', () => {
      const root = resolve(__dirname, '../../..')
      const mounts = execFileSync(
        'git',
        [
          'grep',
          '-l',
          '-e',
          '<AdvertisingTagMounts',
          '--',
          'apps',
          'libs',
          ':!*.spec.*',
        ],
        { cwd: root, encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean)
      // Non-emptiness first: a grep that found nothing would "prove" scope by
      // proving the feature does not exist.
      expect(mounts.length).toBeGreaterThan(0)
      // The tenant wrapper and the console component, and nothing else. A
      // third caller is a third surface with a third opinion about consent,
      // which is what the shared mount exists to make unnecessary.
      expect(mounts.sort()).toEqual([
        'apps/console/components/advertising-tags.component.tsx',
        'apps/tenant/app/[host]/[[...slug]]/advertising-tags.tsx',
      ])
    })
  })
  /**
   * (g) Every vendor the gate can load is DISCLOSED (AGL-2486).
   *
   * `META_PIXEL_VENDOR` declared `cookiePrefixes: ['_fbp','_fbc']` from the day
   * advertising shipped, and no row in the console's cookie inventory named
   * either. Every check in the repo was green throughout, because the
   * inventory's own guard keys on files that WRITE a cookie and our advertising
   * code only ever CLEARS one — a writer-based scan cannot see a vendor whose
   * tag sets cookies from a script we do not author, which is nearly every
   * vendor there will ever be.
   *
   * `cookiePrefixes` is the right key precisely because it is maintained for
   * TEARDOWN: a vendor cannot be complete enough to revoke while being too
   * incomplete to disclose.
   *
   * ## Why this lives HERE and reads the inventory as TEXT
   *
   * It belongs to the console's inventory and was written there first — which
   * turned (f) red, because importing `app-utils/advertising-tags` from
   * `apps/console` is exactly the DPA §3.2 boundary (f) exists to defend. That
   * guard was right and stays untouched. So the check moved to the side that
   * may legitimately hold the vendor registry, and reaches the inventory the
   * same way (f) reaches console sources: as source text, no import, no
   * dependency edge in either direction.
   */
  describe('(g) every vendor the gate can load is disclosed', () => {
    const INVENTORY = 'apps/console/constants/cookie-inventory.ts'

    const inventorySource = () =>
      readFileSync(resolve(__dirname, '../../..', INVENTORY), 'utf8')

    /**
     * Vendor prefixes with no cookie name declared for them.
     *
     * Reads the `names: [...]` arrays rather than every quoted underscore in
     * the file. The old pattern was `/'(_[A-Za-z0-9_<>]+)'/` — every
     * advertising cookie it had ever seen began with one, and LinkedIn's do
     * not: `li_sugr`, `bcookie`, `lidc`, `UserMatchHistory`. It failed CLOSED,
     * which is the right direction, but it could not see a correct disclosure
     * and so could never go green on that vendor.
     *
     * Scoping to the arrays is what lets the pattern widen safely. Matching
     * any quoted word in the file would fail OPEN instead — a vendor's name
     * mentioned in a docblock would read as a declared cookie.
     */
    const undisclosed = (source: string): string[] => {
      const declared = [...source.matchAll(/names:\s*\[([^\]]*)\]/g)].flatMap(
        (block) =>
          [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
      )
      const missing: string[] = []
      for (const vendor of ADVERTISING_VENDORS) {
        for (const prefix of vendor.cookiePrefixes) {
          if (!declared.some((name) => name.startsWith(prefix))) {
            missing.push(`${vendor.label}: ${prefix}`)
          }
        }
      }
      return missing
    }

    it('the inventory names a cookie for every vendor prefix', () => {
      const source = inventorySource()
      // Anti-vacuity: prove the file was actually read and the registry is
      // populated, or "nothing undisclosed" is just "nothing looked at".
      expect(source.length).toBeGreaterThan(1000)
      expect(ADVERTISING_VENDORS.length).toBeGreaterThan(1)
      expect(undisclosed(source)).toEqual([])
    })

    it('CONTROL — the same check REPORTS a prefix the inventory omits', () => {
      // The state the repo was actually in until AGL-2486. Strip Meta's names
      // from the text and the check must name Meta, otherwise the green above
      // is the matcher reading nothing.
      const stripped = inventorySource()
        .replace(/'_fbp'/g, "'x'")
        .replace(/'_fbc'/g, "'x'")
      expect(undisclosed(stripped).join(' ')).toContain('Meta')
    })
  })
})

/**
 * ONE `gtag.js`, however many Google products are configured (AGL-1152).
 *
 * This is the case that costs money if it is wrong, and it is invisible when
 * it is: two copies of the same library both work. The page renders, the
 * network tab shows two 200s, and nothing anywhere reports an error — the only
 * symptom is that every pageview and every conversion is counted twice, so the
 * reported cost per conversion is half the real one and Smart Bidding is
 * trained on the doubled figure.
 *
 * Google Ads and GA4 are served by the SAME library at
 * `googletagmanager.com/gtag/js`; two products on one page is two `config`
 * calls, not two script tags. The vendor declares that with `sharesLibrary`
 * and the component skips its own `<script>` when a matching one is already
 * in the document.
 *
 * ⚠️ Asserted on the DOCUMENT, not on a flag. `sharedLibraryPresent` reads
 * `document.querySelector`, so a test that stubbed it would be testing the
 * stub; these cases put a real `<script src=…>` in the document and count what
 * the component adds beside it.
 */
describe('a shared library is fetched once, not once per product', () => {
  const ADS_ID = 'AW-18401436785'
  const withAds = {
    ...OUR_HOST,
    analytics: {
      ...OUR_HOST.analytics,
      adTags: { ...OUR_HOST.analytics.adTags, 'google-ads': ADS_ID },
    },
  }
  /** Every element this vendor is answerable for. */
  const adsScripts = () =>
    Array.from(
      document.querySelectorAll(
        `script[${ADVERTISING_TAG_ATTRIBUTE}="${GOOGLE_ADS_VENDOR.id}"]`,
      ),
    )
  const adsLibrary = () =>
    adsScripts().filter((element) =>
      String((element as HTMLScriptElement).getAttribute('src') ?? '').includes(
        GOOGLE_ADS_VENDOR.scriptMatch,
      ),
    )
  /** What the GA gate itself puts on the page, before this component runs. */
  const placeGaLoader = () => {
    const existing = document.createElement('script')
    existing.src =
      `https://www.googletagmanager.com/gtag/js?id=${PLATFORM_GA_MEASUREMENT_ID}`
    document.head.append(existing)
    return existing
  }

  it('THE CONTROL: with no GA loader present, Ads brings its own', () => {
    // Without this the skip below is indistinguishable from Google Ads never
    // rendering a library at all.
    storeVisitorConsent(HOST_ID, {
      status: 'accepted',
      country: 'US',
      advertising: true,
    })
    return renderGate(withAds).then(() => {
      expect(adsLibrary().length).toBe(1)
    })
  })

  it('the copy it brings NAMES THE ACCOUNT, so a container is registered', async () => {
    /*
     * AGL-2559. `gtag.js` resolves which container to configure from the
     * loader's `?id=`, not from the `config` call that follows it. Fetched
     * bare it still returns 200 and still defines `gtag()`, so the page looks
     * correct in every way a test that only counted elements could see —
     * while `config` for the account queues against a runtime holding no such
     * container and nothing is ever reported.
     *
     * Measured on `app.aglyn.com` before the fix: one bare
     * `googletagmanager.com/gtag/js` request, `google_tag_data.tidr.container`
     * holding the GA4 id and an EMPTY string, and zero requests to
     * `googleadservices`.
     */
    storeVisitorConsent(HOST_ID, {
      status: 'accepted',
      country: 'US',
      advertising: true,
    })
    await renderGate(withAds)
    const [library] = adsLibrary()
    expect(library).toBeTruthy()
    const src = String(library.getAttribute('src'))
    expect(new URL(src).searchParams.get('id')).toBe(ADS_ID)
  })

  it('the account in the loader is the CONFIGURED one, not a constant', () => {
    // A `scriptSrcFor` that ignored its argument would satisfy the case above
    // for every account, including a self-hoster's.
    const other = 'AW-99887766'
    expect(GOOGLE_ADS_VENDOR.scriptSrcFor).toBeTruthy()
    const built = String(GOOGLE_ADS_VENDOR.scriptSrcFor?.(other))
    expect(new URL(built).searchParams.get('id')).toBe(other)
    // And it stays the library the skip and the CSP origin are keyed on.
    expect(built).toContain(GOOGLE_ADS_VENDOR.sharesLibrary as string)
    expect(new URL(built).origin).toBe(
      new URL(GOOGLE_ADS_VENDOR.scriptSrc as string).origin,
    )
  })

  it('Meta takes its id in the boot, so it has no per-account loader', () => {
    // The field is the exception, not the rule. A vendor that grew one by
    // copy-paste would put an account id in a URL its library never reads.
    expect(META_PIXEL_VENDOR.scriptSrcFor).toBeUndefined()
  })

  it('skips its own copy when the GA loader is already in the document', async () => {
    storeVisitorConsent(HOST_ID, {
      status: 'accepted',
      country: 'US',
      advertising: true,
    })
    placeGaLoader()
    await renderGate(withAds)
    // The library the browser fetches: exactly the one GA put there.
    expect(adsLibrary().length).toBe(0)
    expect(
      document.querySelectorAll(
        `script[src*="${GOOGLE_ADS_VENDOR.scriptMatch}"]`,
      ).length,
    ).toBe(1)
  })

  it('still boots, so the second product is configured on the one library', async () => {
    /*
     * The skip must drop the LIBRARY and keep the BOOT. Dropping both would
     * leave `gtag.js` loaded with no `config` for the Ads id — no double
     * count, and no measurement either, which is the failure that looks like
     * success.
     */
    storeVisitorConsent(HOST_ID, {
      status: 'accepted',
      country: 'US',
      advertising: true,
    })
    placeGaLoader()
    await renderGate(withAds)
    const boots = adsScripts().filter((element) => !element.getAttribute('src'))
    expect(boots.length).toBe(1)
    expect(boots[0].textContent).toContain(ADS_ID)
  })

  it('the boot pushes a consent UPDATE and never a default', async () => {
    /*
     * A `consent default` arriving from the second product would re-deny what
     * the GA loader granted moments earlier, in the same pageview — the tags
     * would be present and silently collecting nothing.
     */
    storeVisitorConsent(HOST_ID, {
      status: 'accepted',
      country: 'US',
      advertising: true,
    })
    await renderGate(withAds)
    const boot = adsScripts().find((element) => !element.getAttribute('src'))
    expect(boot).toBeTruthy()
    expect(boot?.textContent).toContain("'update'")
    expect(boot?.textContent).not.toContain("'default'")
  })

  it('the vendor names the library it shares, and it is gtag', () => {
    // The skip is keyed on this string; a typo would silently never match and
    // the double fetch would come back with no test turning red.
    expect(GOOGLE_ADS_VENDOR.sharesLibrary).toBe('googletagmanager.com/gtag/js')
    expect(GOOGLE_ADS_VENDOR.scriptSrc).toContain(
      GOOGLE_ADS_VENDOR.sharesLibrary as string,
    )
  })

  it('Meta does NOT share it, so its own library is never skipped', () => {
    // The skip is per-vendor. A pixel that inherited it would stop loading on
    // any site that also runs Google Analytics — which is most of them.
    expect(META_PIXEL_VENDOR.sharesLibrary).toBeUndefined()
  })
})
