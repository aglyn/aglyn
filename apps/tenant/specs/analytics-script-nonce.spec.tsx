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
 * The tenant's analytics mount hands a CSP nonce to EVERY inline boot and
 * library it renders — the GA pair, the container pair and the advertising
 * pairs — asserted on the script elements, the layer a policy reads.
 *
 * The tenant sends no `script-src` today (AGL-1228), so nothing refuses an
 * unnonced script on this surface. This pins the seam for the day that
 * changes: the console's enforcing policy refused its inline boots while the
 * libraries beside them loaded (AGL-2640), and the same shape — `ga-init`
 * ahead of `ga-src` — lives here. A nonce reaching four of the six elements
 * would be the console's defect rebuilt on this surface, which is why every
 * element is named rather than counted.
 */
import { PLATFORM_GA_MEASUREMENT_ID } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import { storeVisitorConsent } from '@aglyn/aglyn/app-utils/visitor-consent'
import { act, render, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

/**
 * `next/script` is inert in jsdom, so it is replaced with a double that
 * appends a REAL `<script>` carrying every string prop — `nonce` included —
 * imperatively, as the real one does at `afterInteractive`. It invents no
 * attribute of its own, so what a case reads is what the mount passed.
 */
jest.mock('next/script', () => {
  const react = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: Record<string, any>): null => {
      const { children, strategy, src, id, ...rest } = props
      react.useEffect(() => {
        const doc = globalThis.document
        const element = doc.createElement('script')
        element.setAttribute('data-testid', String(id))
        for (const [key, value] of Object.entries(rest)) {
          if (typeof value === 'string') element.setAttribute(key, value)
        }
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

const HOST_ID = 'nonce-host'
const NONCE = 'c0ffee0123456789'

/**
 * Aglyn's own marketing site with every kind of tag configured: the platform
 * measurement id (which is what makes it OUR surface, so the advertising
 * machinery is active), a container, and a Meta pixel — a vendor that brings
 * its own library rather than riding `gtag.js`, so its pair is two elements.
 */
const OUR_HOST = {
  $id: HOST_ID,
  analytics: {
    gaMeasurementId: PLATFORM_GA_MEASUREMENT_ID,
    gtmContainerId: 'GTM-ABCDE12',
    adTags: { meta: '1234567890123456' },
  },
  consent: { advertising: true },
}

/** Every element the mount is answerable for, by the id it renders live. */
const SCRIPT_IDS = [
  'ga-init',
  'ga-src',
  'gtm-init',
  'gtm-src',
  'ad-tag-meta-init',
  'ad-tag-meta-src',
] as const

const scriptById = (id: string) =>
  document.querySelector<HTMLScriptElement>(`script[data-testid="${id}"]`)

/** Plants the region the /api/consent/region endpoint reports. */
function plantRegion(country: string | null) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return { ok: true, json: async () => ({ country }) }
  })
}

async function renderPage(nonce?: string) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(<SiteAnalytics host={OUR_HOST as any} nonce={nonce} />)
  })
  return result
}

/**
 * A PRODUCTION deployment on a real hostname, or `analyticsMayEmit()` is
 * false and nothing mounts at all (AGL-2067) — every case here would then pass
 * on an empty document. The URL is in this file's first docblock.
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

beforeEach(() => {
  plantRegion('US')
  // An explicit grant of both categories: the one state in which every pair
  // renders — the GA and container pairs ride analytics, the pixel rides
  // advertising.
  storeVisitorConsent(HOST_ID, {
    status: 'accepted',
    country: 'US',
    advertising: true,
  })
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (global as any).fetch
  for (const id of SCRIPT_IDS) scriptById(id)?.remove()
})

describe("the tenant's analytics mount and the CSP nonce", () => {
  it('stamps the nonce onto all six elements — GA, container and vendor pairs', async () => {
    await renderPage(NONCE)
    // Non-emptiness first: the state above renders every pair, and a case
    // that asserted an attribute on an absent element would prove nothing.
    await waitFor(() => {
      for (const id of SCRIPT_IDS) expect(scriptById(id)).not.toBeNull()
    })
    for (const id of SCRIPT_IDS) {
      expect(scriptById(id)?.getAttribute('nonce')).toBe(NONCE)
    }
  })

  it('stamps nothing when no nonce is handed down — the attribute is the prop', async () => {
    // The control: a double that invented a nonce would let the case above
    // pass against a mount that forwards nothing.
    await renderPage(undefined)
    await waitFor(() => {
      for (const id of SCRIPT_IDS) expect(scriptById(id)).not.toBeNull()
    })
    for (const id of SCRIPT_IDS) {
      expect(scriptById(id)?.hasAttribute('nonce')).toBe(false)
    }
  })
})
