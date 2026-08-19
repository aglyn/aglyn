/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the `Request`/`Response`
 * the two route handlers below are driven with do not exist.
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
 * A free site past its bandwidth band is REFUSED by the real serving path
 * (AGL-1967/2070/2155) — driven through the loader, the edge verdict and the
 * notice page, with the identical fixture on a PAID plan served normally at
 * every one of the three.
 *
 * ## Why the positive control is not optional here
 *
 * A cap is trivially satisfiable by a product nobody can use. Every refusal
 * below is therefore paired with the same org, the same marker and the same
 * month on a starter subscription, which must serve — because the promise
 * that a metered plan bills its overage instead of being cut off is older
 * than this cap and larger than it. A suite that only proved the refusal
 * would pass just as happily against a platform that had taken every site
 * on it down.
 *
 * ## The three layers, and which one actually stops the egress
 *
 * The MIDDLEWARE is the gate that matters: it runs before the ISR cache, and
 * a capped site's remaining traffic is served from that cache. It cannot be
 * driven in jest (edge runtime), so what is asserted here is the contract it
 * consumes — `/api/lockdown-verdict` answering `overQuota` — plus the notice
 * page it rewrites to. The loader branch is the defence in depth behind it
 * and IS driven end to end.
 */

const mockGetPlatformLockdown = jest.fn(async (): Promise<unknown> => null)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
  getPlatformLockdown: (...args: unknown[]) =>
    mockGetPlatformLockdown(...(args as [])),
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getRealmPluginInstalls: jest.fn(async () => []),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  getHost: jest.fn(),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: null })),
  getOrgBilling: jest.fn(async () => ({ org: null })),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: jest.fn(async () => undefined) },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ root: {} })),
  composeNodesWithChrome: jest.fn(async () => ({ root: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    screen: { $id: 'home', versionId: 'v1' },
    error: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    collection: null,
    entries: [],
    entry: null,
  })),
}))
jest.mock('@aglyn/tenant-runtime/compose-collection-page', () => ({
  __esModule: true,
  composeCollectionTemplatePage: jest.fn(async () => null),
  composeCollectionFallbackPage: jest.fn(async () => null),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
}))

import {
  BANDWIDTH_CAP_CODE,
  bandwidthCapMonthKey,
  bandwidthCapNotice,
} from '@aglyn/aglyn/server'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import { GET as lockdownVerdict } from '../app/api/lockdown-verdict/route'
import { GET as lockedNotice } from '../app/api/locked/route'
import getHost, { getHost as getHostNamed } from '../utils/get-host'
import getOrgBilling, {
  getOrgBilling as getOrgBillingNamed,
} from '../utils/get-org-billing'

const mockGetHost = getHost as unknown as jest.Mock
const mockGetHostNamed = getHostNamed as unknown as jest.Mock
const mockGetOrgBilling = getOrgBilling as unknown as jest.Mock
const mockGetOrgBillingNamed = getOrgBillingNamed as unknown as jest.Mock

const HOST = { $id: 'host-1', subdomain: 'acme', screens: { home: '/' } }

/** THE MARKER the daily sweep writes on a free org that blew its band. */
const CAP = {
  month: bandwidthCapMonthKey(),
  engagedAt: 1,
  pageViews: 1_000_000,
}

/** Free, over the band. 1M page views against a band of ~8.7k. */
const cappedFreeOrg = { $id: 'org-1', plan: 'free', bandwidthCap: CAP }

/**
 * THE POSITIVE CONTROL: byte-identical, on the cheapest plan that meters.
 * Same marker, same month, same measured traffic — only the plan differs.
 */
const cappedPaidOrg = {
  $id: 'org-1',
  plan: 'starter',
  subscription: { status: 'active' },
  bandwidthCap: CAP,
}

const setOrg = (org: unknown) => {
  mockGetOrgBilling.mockResolvedValue({ org })
  mockGetOrgBillingNamed.mockResolvedValue({ org })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPlatformLockdown.mockResolvedValue(null)
  mockGetHost.mockResolvedValue({ host: { ...HOST }, error: null })
  mockGetHostNamed.mockResolvedValue({ host: { ...HOST }, error: null })
  setOrg({ $id: 'org-1', plan: 'free' })
})

describe('THE LOADER refuses a capped free site (defence in depth)', () => {
  it('CONTROL — a free org inside its band serves the page', () => {
    // Proves the branch below is reached by the CAP and not by being free.
    return loadPageData('acme', []).then((result: any) => {
      expect(result.props?.maintenanceFallback).toBeUndefined()
      expect(result.props?.lockdown).toBeUndefined()
    })
  })

  it('a capped FREE org serves the notice instead of the page', async () => {
    setOrg(cappedFreeOrg)
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    // The page itself is gone — this is the refusal, not a banner on it.
    expect(result.props.nodes).toBeNull()
    expect(result.props.lockdown.reason).toBe(BANDWIDTH_CAP_CODE)
    expect(result.props.lockdown.title).toBe(bandwidthCapNotice().title)
    // Short window: an upgrade must not wait out a full ISR period.
    expect(result.revalidate).toBe(30)
  })

  it('POSITIVE CONTROL: the same marker on a PAID plan serves normally', async () => {
    setOrg(cappedPaidOrg)
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.lockdown).toBeUndefined()
  })

  it('LAST MONTH’s marker serves — nothing had to clear it', async () => {
    setOrg({
      ...cappedFreeOrg,
      bandwidthCap: { month: '2020-01', engagedAt: 1 },
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
  })

  it('a capped site’s notice names no plan, price or band', async () => {
    // The visitor is a stranger to this site. Asserted on the SERIALIZED
    // payload, because that is what actually reaches the browser.
    setOrg(cappedFreeOrg)
    const result: any = await loadPageData('acme', [])
    const payload = JSON.stringify(result.props.lockdown).toLowerCase()
    for (const leak of [
      'free',
      'plan',
      'upgrade',
      'billing',
      'gb',
      '1000000',
    ]) {
      expect(payload).not.toContain(leak)
    }
  })
})

describe('THE EDGE VERDICT — the contract the middleware reads', () => {
  const verdict = async () =>
    (await (
      await lockdownVerdict(
        new Request('https://acme.aglyn.app/api/lockdown-verdict?host=acme'),
      )
    ).json()) as Record<string, unknown>

  it('answers overQuota TRUE for a capped free org', async () => {
    setOrg(cappedFreeOrg)
    expect(await verdict()).toMatchObject({ locked: false, overQuota: true })
  })

  it('POSITIVE CONTROL: overQuota FALSE for the same marker when paid', async () => {
    setOrg(cappedPaidOrg)
    expect(await verdict()).toMatchObject({ overQuota: false })
  })

  it('answers overQuota FALSE for an uncapped free org', async () => {
    expect(await verdict()).toMatchObject({ overQuota: false })
  })

  it('FAILS OPEN: a thrown org read serves rather than caps', async () => {
    // An unreachable org doc is an outage. Capping on it would take every
    // free site on the platform down at once over a Firestore blip.
    mockGetOrgBillingNamed.mockRejectedValue(new Error('firestore down'))
    expect(await verdict()).toMatchObject({ locked: false, overQuota: false })
  })

  it('discloses no usage figure, plan or band', async () => {
    setOrg(cappedFreeOrg)
    const body = JSON.stringify(await verdict()).toLowerCase()
    for (const leak of ['free', 'starter', 'plan', '1000000', 'bandwidthgb']) {
      expect(body).not.toContain(leak)
    }
  })
})

describe('THE NOTICE PAGE the middleware rewrites to', () => {
  const fetchNotice = () =>
    lockedNotice(
      new Request('https://acme.aglyn.app/api/locked', {
        headers: { 'x-aglyn-tenant-host': 'acme' },
      }),
    )

  it('a capped site gets a real 503, noindex, with an hour’s Retry-After', async () => {
    // 503 and not 402/403 ON PURPOSE: it is the only status that tells a
    // crawler to come back, so one busy month cannot de-index a customer.
    setOrg(cappedFreeOrg)
    const response = await fetchNotice()
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('3600')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const html = await response.text()
    expect(html).toContain('name="robots" content="noindex"')
    expect(html).toContain(bandwidthCapNotice().title)
  })

  it('POSITIVE CONTROL: the same marker when PAID gets the generic body', async () => {
    // Not the cap copy — nothing about this org is capped, so a visitor who
    // navigates here directly cannot be shown a traffic-limit notice for it.
    setOrg(cappedPaidOrg)
    const html = await (await fetchNotice()).text()
    expect(html).not.toContain(bandwidthCapNotice().title)
    expect(html).toContain('Temporarily unavailable')
  })

  it('a LOCK outranks a cap, and is worded as a lock', async () => {
    // Both refusals answer 503 from this one route, so precedence is the only
    // thing keeping a staff takedown from being described as a traffic limit.
    setOrg({
      ...cappedFreeOrg,
      suspendedAt: { seconds: 1_700_000_000 },
      suspendedReasonCode: 'security',
    })
    const html = await (await fetchNotice()).text()
    expect(html).not.toContain(bandwidthCapNotice().title)
  })
})
