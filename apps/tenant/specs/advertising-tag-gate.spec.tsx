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
  META_PIXEL_VENDOR,
  resolveAdvertisingTags,
  revokeAdvertisingTags,
} from '@aglyn/aglyn/app-utils/advertising-tags'
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
    it('(a) an implied visitor on a host that never ASKED gets nothing', async () => {
      // `implied` grants analytics, and since AGL-2402 it can grant
      // advertising too — but only where the host opted into asking. Omitted
      // means NO, so this record carries no advertising grant and the gate
      // must produce nothing. The trap this guards is the gate reusing
      // `isAnalyticsAllowed`, which would go green by accident.
      const stored = storeVisitorConsent(HOST_ID, {
        status: 'implied',
        country: 'US',
      })
      expect(stored.analytics).toBe(true)

      await renderGate(OUR_HOST)
      expect(vendorScripts()).toHaveLength(0)
    })

    it('(a2) …and not for a REFUSAL record that claims otherwise', async () => {
      // A hand-edited record: a refusal status with `advertising: true`
      // written in. The engine re-derives the grant against the STATUS, so
      // the gate's answer must not depend on the file on disk being honest.
      //
      // This used to pin `implied` the same way. Since AGL-2402 an implied
      // record legitimately carries an advertising grant outside the
      // prior-consent regions — it is what `decideVisitorConsent` writes —
      // so the tampering case moved to the statuses that must ALWAYS refuse.
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
        expect(vendorScripts()).toHaveLength(0)
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
   * The console half of (f). It cannot be a render test, because the thing
   * being asserted is that there is nothing to render: `app.aglyn.com` does
   * not go through the tenant route and never mounts `SiteAnalytics`, so no
   * amount of driving the console can produce a vendor tag. What CAN regress
   * is someone importing this machinery into the console directly, and that is
   * what this scans for.
   *
   * Aglyn's DPA §3.2 promises customers we do not "sell"/"share" Customer
   * Personal Data. The console is where customers' own data lives, so an ad
   * pixel there is the breach this whole feature is scoped away from — the one
   * worth a guard that fires on an import rather than on a behaviour.
   */
  describe('(f) the console has no mount point at all', () => {
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

    it('no console file imports the advertising gate or names the vendor', () => {
      const files = consoleSources()
      // The scan found the app it is meant to police. Without this the loop
      // below is `[].every()` — green over nothing, the exact vacuous shape
      // this repo has shipped before.
      expect(files.length).toBeGreaterThan(200)
      expect(files.some((f) => f.file.endsWith('constants/cookie-inventory.ts')))
        .toBe(true)

      const offenders = files.filter(
        ({ source }) =>
          source.includes('app-utils/advertising-tags') ||
          source.includes(META_PIXEL_VENDOR.scriptMatch) ||
          /\bfbq\b/.test(source),
      )
      expect(offenders.map((f) => f.file)).toEqual([])
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

    /** Vendor prefixes with no cookie name declared for them. */
    const undisclosed = (source: string): string[] => {
      const declared = [...source.matchAll(/'(_[A-Za-z0-9_<>]+)'/g)].map(
        (match) => match[1],
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
