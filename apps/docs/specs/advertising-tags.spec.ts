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
 * The docs site's advertising-tag gate, asserted on the SCRIPT ELEMENTS it
 * appends and on the GLOBALS those elements define.
 *
 * The gate here is not a dialog and not a region lookup — it is the
 * `aglyn_consent` mirror the console writes at the registrable domain. So the
 * cases below drive that cookie and nothing else, which is exactly the surface
 * area a visitor's browser presents to this module.
 *
 * Every denial case sits beside a positive CONTROL that shares its setup: a
 * suite where the tags never mount for any reason would otherwise be green
 * from end to end while proving nothing.
 */

const PIXEL_ID = '1931535658229774'
const ADS_ID = 'AW-18401436785'
const PARTNER_ID = '9626898'
const CONTAINER_ID = 'GTM-N65S88G'

const CUSTOM_FIELDS = {
  advertisingTagIds: {
    meta: PIXEL_ID,
    'google-ads': ADS_ID,
    linkedin: PARTNER_ID,
  },
  gtmContainerId: CONTAINER_ID,
}

const VENDOR_GLOBALS = [
  'fbq',
  '_fbq',
  'gtag',
  'dataLayer',
  '_linkedin_partner_id',
  '_linkedin_data_partner_ids',
]

const adScripts = () =>
  Array.from(document.querySelectorAll('script[data-aglyn-ad-tag]'))

const vendorScripts = (vendorId: string) =>
  Array.from(
    document.querySelectorAll(`script[data-aglyn-ad-tag="${vendorId}"]`),
  )

/**
 * Run every inline boot that was appended, against the real window.
 *
 * `window.eval`, not `new Function`: a snippet's `function gtag(){…}` is a
 * GLOBAL declaration in a real `<script>` and a local one inside a function
 * body, so evaluating it anywhere else would quietly prove the wrong thing.
 */
function executeMountedBoots(): void {
  for (const element of adScripts()) {
    const text = element.textContent ?? ''
    if (!text) continue
    ;(window as unknown as { eval: (code: string) => unknown }).eval(text)
  }
}

/** Write the mirror the console would have written. */
function writeMirror(record: Record<string, unknown> | null): void {
  if (record === null) {
    document.cookie = 'aglyn_consent=; Max-Age=0; Path=/'
    return
  }
  document.cookie = `aglyn_consent=${encodeURIComponent(
    JSON.stringify(record),
  )}; Path=/`
}

/**
 * Load the module fresh. It arms at IMPORT time — a Docusaurus client module
 * has no other entry point — so every case has to control the world before the
 * require, exactly as `error-beacon.spec.ts` does.
 */
function loadModule(): { onRouteUpdate: () => void } {
  let loaded!: { onRouteUpdate: () => void }
  jest.isolateModules(() => {
    loaded = require('../src/advertising-tags')
  })
  return loaded
}

const mutableEnv = process.env as Record<string, string | undefined>
const savedNodeEnv = process.env.NODE_ENV

beforeEach(() => {
  // The module arms only in a production build, mirroring the gtag posture in
  // docusaurus.config.ts. Without this every case below would pass because
  // nothing ever mounts.
  mutableEnv.NODE_ENV = 'production'
  ;(globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__'] =
    CUSTOM_FIELDS
})

afterEach(() => {
  mutableEnv.NODE_ENV = savedNodeEnv
  delete (globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__']
  for (const element of Array.from(
    document.querySelectorAll('script[data-aglyn-ad-tag]'),
  )) {
    element.remove()
  }
  for (const key of VENDOR_GLOBALS) {
    const scope = window as Record<string, any>
    try {
      delete scope[key]
    } catch {
      // A global function declaration is non-configurable; assignment clears
      // it where `delete` cannot.
      scope[key] = undefined
    }
  }
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
})

describe("the docs site's advertising-tag gate", () => {
  /**
   * THE CONTROL. Everything below that asserts "nothing mounted" is only worth
   * something because this proves the same fixtures CAN mount all four.
   */
  describe('a mirrored console record that grants advertising', () => {
    it('mounts every configured vendor and defines their globals', () => {
      writeMirror({ status: 'implied', analytics: true, advertising: true })
      loadModule()

      expect(vendorScripts('meta')).toHaveLength(2)
      expect(vendorScripts('google-ads')).toHaveLength(2)
      expect(vendorScripts('linkedin')).toHaveLength(2)

      const sources = adScripts()
        .map((element) => element.getAttribute('src') ?? '')
        .filter(Boolean)
      expect(sources).toEqual(
        expect.arrayContaining([
          expect.stringContaining('connect.facebook.net'),
          expect.stringContaining('snap.licdn.com'),
          expect.stringContaining('googletagmanager.com/gtag/js'),
          expect.stringContaining(
            `googletagmanager.com/gtm.js?id=${CONTAINER_ID}`,
          ),
        ]),
      )

      executeMountedBoots()
      const scope = window as Record<string, any>
      expect(typeof scope.fbq).toBe('function')
      expect(scope._linkedin_partner_id).toBe(PARTNER_ID)
      expect(scope._linkedin_data_partner_ids).toContain(PARTNER_ID)
      expect(Array.isArray(scope.dataLayer)).toBe(true)
    })

    it('grants all three Consent Mode v2 advertising signals to the Ads tag', () => {
      // Remarketing needs `ad_storage`, `ad_user_data` AND `ad_personalization`.
      // Two out of three is a tag that looks healthy and feeds no audience.
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      loadModule()
      const boot = vendorScripts('google-ads')
        .map((element) => element.textContent ?? '')
        .join('')
      expect(boot).toContain("ad_storage:'granted'")
      expect(boot).toContain("ad_user_data:'granted'")
      expect(boot).toContain("ad_personalization:'granted'")
      expect(boot).not.toContain('allow_ad_personalization_signals')
    })

    it('mounts the container without a noscript iframe beside it', () => {
      writeMirror({ status: 'implied', analytics: true, advertising: true })
      loadModule()
      expect(vendorScripts('gtm')).toHaveLength(2)
      expect(document.querySelectorAll('noscript')).toHaveLength(0)
    })
  })

  describe('every state that must mount no vendor', () => {
    it('mounts nothing when the visitor has no mirrored record', () => {
      writeMirror(null)
      loadModule()
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      expect(vendorScripts('google-ads')).toHaveLength(0)
      executeMountedBoots()
      expect((window as Record<string, any>).fbq).toBeUndefined()
      expect(
        (window as Record<string, any>)._linkedin_partner_id,
      ).toBeUndefined()
    })

    it.each(['declined', 'opted-out', 'gpc-opt-out'])(
      'mounts nothing for a %s record, even one claiming an advertising yes',
      (status) => {
        // A hand-edited cookie cannot grant what its status does not support.
        writeMirror({ status, analytics: false, advertising: true })
        loadModule()
        expect(vendorScripts('meta')).toHaveLength(0)
        expect(vendorScripts('linkedin')).toHaveLength(0)
        executeMountedBoots()
        expect((window as Record<string, any>).fbq).toBeUndefined()
      },
    )

    it('mounts nothing for a granting status that did not grant advertising', () => {
      writeMirror({ status: 'implied', analytics: true, advertising: false })
      loadModule()
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      // The container is analytics-gated, not advertising-gated, so it is the
      // control that proves this case is about the category and not the load.
      expect(vendorScripts('gtm')).toHaveLength(2)
    })

    it('mounts nothing at all outside a production build', () => {
      mutableEnv.NODE_ENV = 'development'
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      loadModule()
      expect(adScripts()).toHaveLength(0)
    })

    it('mounts nothing for a vendor this build does not configure', () => {
      ;(globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__'] = {
        advertisingTagIds: { 'google-ads': ADS_ID },
        gtmContainerId: null,
      }
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      loadModule()
      // The control inside the case: an absent id, not an absent grant.
      expect(vendorScripts('google-ads')).toHaveLength(2)
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('gtm')).toHaveLength(0)
    })

    it('refuses a malformed id rather than injecting it into a script', () => {
      ;(globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__'] = {
        advertisingTagIds: {
          meta: "12345678'));alert(1)//",
          linkedin: PARTNER_ID,
        },
      }
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      loadModule()
      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(2)
    })
  })

  describe('withdrawal made on a sibling origin', () => {
    it('tears the tags down and sweeps their cookies when the tab is looked at again', () => {
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      const loaded = loadModule()
      expect(vendorScripts('meta')).toHaveLength(2)

      // The library has EXECUTED and written its identifiers, which is the
      // state a render-time gate cannot undo on its own.
      const calls: unknown[][] = []
      ;(window as Record<string, any>).fbq = (...args: unknown[]) => {
        calls.push(args)
      }
      document.cookie = '_fbp=fb.1.test; path=/'
      expect(document.cookie).toContain('_fbp=')

      // The console withdrew. Nothing tells this origin; the next look does.
      writeMirror({ status: 'opted-out', analytics: false, advertising: false })
      loaded.onRouteUpdate()

      expect(vendorScripts('meta')).toHaveLength(0)
      expect(vendorScripts('linkedin')).toHaveLength(0)
      expect(calls).toContainEqual(['consent', 'revoke'])
      expect(document.cookie).not.toContain('_fbp=')
    })

    it('does not re-mount a vendor that is already resident on a route change', () => {
      writeMirror({ status: 'accepted', analytics: true, advertising: true })
      const loaded = loadModule()
      expect(vendorScripts('meta')).toHaveLength(2)
      loaded.onRouteUpdate()
      loaded.onRouteUpdate()
      expect(vendorScripts('meta')).toHaveLength(2)
    })
  })
})
