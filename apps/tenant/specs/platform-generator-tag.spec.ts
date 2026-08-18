/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * `<meta name="generator" content="Aglyn" />`, and the sites that must NOT
 * have it (AGL-2088).
 *
 * The generator tag is the canonical CMS signal — WordPress, Squarespace,
 * Drupal and Ghost all ship one — and Aglyn shipped none, which is why
 * Wappalyzer reads a live Aglyn site as "Next.js, React, Emotion, Vercel".
 *
 * ## Why every case here is written twice
 *
 * The cheap version of this suite asserts the tag is present and stops. That
 * test passes against a `generator` hard-coded in the root layout, against a
 * gate wired backwards, and against a gate deleted entirely — every
 * implementation that leaks. The failure worth preventing is not a missing
 * tag on a free site, which someone would notice; it is a tag on a
 * white-labelled site, which nobody would, because the customer who is harmed
 * is precisely the one who is not looking at their own response headers.
 *
 * So each behaviour is asserted from BOTH sides against fixtures that differ
 * in one field, and the suppression cases outnumber the emission ones.
 *
 * The mocks stop at the two data helpers rather than at
 * `hostShowsPlatformAttribution`, deliberately: the fail-closed branches in
 * that helper and the entitlement rule in `showsPlatformAttribution` are the
 * code under test here, and mocking the helper would replace them with the
 * test's own opinion.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// A large browser-side graph that `generateMetadata` never touches.
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  getHost: jest.fn(),
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(),
  getOrgBilling: jest.fn(),
}))

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import { generateMetadata } from '../app/[host]/[[...slug]]/page'
import getHost from '../utils/get-host'
import getOrgBilling from '../utils/get-org-billing'

const mockLoad = loadPageData as jest.Mock
const mockHost = getHost as unknown as jest.Mock
const mockOrg = getOrgBilling as unknown as jest.Mock

const HOST = 'acme'

/** A perfectly ordinary published screen; the head content is not the subject. */
const givenPage = () =>
  mockLoad.mockResolvedValue({
    props: {
      data: {
        host: { $id: 'host-1', displayName: 'Acme', seo: { title: 'Acme' } },
        screen: { data: { $id: 'screen-1', displayName: 'Home' } },
      },
      nodes: null,
    },
  })

const givenOrg = (org: unknown) => {
  mockHost.mockResolvedValue({ host: { $id: 'host-1' } })
  mockOrg.mockResolvedValue({ org })
}

const metadata = () =>
  generateMetadata({
    params: Promise.resolve({ host: HOST, slug: [] }),
  } as never) as Promise<any>

beforeEach(() => {
  jest.clearAllMocks()
  givenPage()
})

describe('a site that may be attributed', () => {
  it('carries the generator tag', async () => {
    givenOrg({ $id: 'org-1', plan: 'pro' })

    expect((await metadata()).generator).toBe('Aglyn')
  })

  it('carries it on the free plan too — the badge gate is a different gate', async () => {
    // `showBranding`/`removeBranding` decides the visible "Made with Aglyn"
    // badge and is granted by every plan above free. Reusing THAT gate here
    // would confine the fingerprint to free sites and leave the corpus this
    // exists to build nearly empty. The two promises differ in kind:
    // `removeBranding` buys a page with no Aglyn credit on it, `whiteLabel`
    // buys concealment of who built the site.
    givenOrg({ $id: 'org-1', plan: 'free' })

    expect((await metadata()).generator).toBe('Aglyn')
  })

  it('CONTROL — the rest of the head is still composed', async () => {
    // Without this, every suppression assertion below would also pass against
    // a `generateMetadata` that returned `{}` for everything, which would take
    // the titles and robots directives of every published site with it.
    givenOrg({ $id: 'org-1', plan: 'pro' })

    expect((await metadata()).title).toBeTruthy()
  })
})

describe('a white-labelled site', () => {
  it('carries NO generator tag', async () => {
    // The expensive case. An Agency org pays for `whiteLabel` so its
    // customers' sites do not disclose the platform; a generator tag is
    // exactly the disclosure, in the exact place a detector reads.
    givenOrg({ $id: 'org-1', plan: 'agency' })

    expect((await metadata()).generator).toBeUndefined()
  })

  it('carries none on enterprise either', async () => {
    givenOrg({ $id: 'org-1', plan: 'enterprise' })

    expect((await metadata()).generator).toBeUndefined()
  })

  it('carries none for a comped org with a per-org override', async () => {
    // How Enterprise grants usually arrive. A gate reading only `plan` misses
    // every one of them.
    givenOrg({
      $id: 'org-1',
      plan: 'pro',
      entitlements: { features: { whiteLabel: true } },
    })

    expect((await metadata()).generator).toBeUndefined()
  })

  it('CONTROL — the same fixture still composes the rest of its head', async () => {
    // Proves the two blocks differ by the ENTITLEMENT and not by the
    // white-label fixture happening to break metadata generation outright.
    givenOrg({ $id: 'org-1', plan: 'agency' })

    expect((await metadata()).title).toBeTruthy()
  })
})

describe('when the org did not resolve', () => {
  it('⚠️ carries NO generator tag on a null org', async () => {
    // `getOrgBilling` fails open with `org: null` on any Firestore error, and
    // a null org resolves as the FREE plan. Under the naive
    // `!checkEntitlement(org, 'whiteLabel')` gate, a transient read failure
    // while serving an Agency customer's site would stamp the tag onto the one
    // site that paid to avoid it — silently, on a path that only runs when
    // something is already going wrong.
    givenOrg(null)

    expect((await metadata()).generator).toBeUndefined()
  })

  it('carries none when the host itself did not resolve', async () => {
    mockHost.mockResolvedValue({ host: undefined })
    mockOrg.mockResolvedValue({ org: { $id: 'org-1', plan: 'pro' } })

    expect((await metadata()).generator).toBeUndefined()
  })

  it('carries none when the lookup throws', async () => {
    mockHost.mockRejectedValue(new Error('firestore unavailable'))

    expect((await metadata()).generator).toBeUndefined()
  })
})
