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
 * The tenant loader's lockdown branch (AGL-1501), with every violation
 * planted: a suspended host, a suspended org, a platform lockdown, and —
 * the restore path — an EXPIRED window serving normally again with no
 * staff action. The resolver itself is the REAL one (`jest.requireActual`
 * would be redundant: `@aglyn/aglyn/server` is not mocked here), so these
 * are the precedence table's answers flowing through the real loader.
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
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ org: null })),
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
  default: jest.fn(async () => ({ collection: null, entries: [], entry: null })),
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

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import getHost from '../utils/get-host'
import getOrgBilling from '../utils/get-org-billing'

const mockGetHost = getHost as jest.Mock
const mockGetOrgBilling = getOrgBilling as unknown as jest.Mock

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  screens: { home: '/' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPlatformLockdown.mockResolvedValue(null)
  mockGetHost.mockResolvedValue({ host: { ...HOST }, error: null })
  mockGetOrgBilling.mockResolvedValue({ org: { $id: 'org-1' } })
})

describe('tenant loader lockdown branch (AGL-1501)', () => {
  it('CONTROL — nothing locked serves the page', async () => {
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.lockdown).toBeUndefined()
  })

  it('a suspended HOST serves the notice with the sanitized copy', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...HOST,
        suspendedAt: Date.now(),
        suspendedReasonCode: 'security',
      },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.nodes).toBeNull()
    expect(result.props.lockdown.reason).toBe('security')
    expect(result.props.lockdown.contact).toBe('support@aglyn.com')
    // Short window: a lift must not wait out a long ISR period.
    expect(result.revalidate).toBe(30)
  })

  it('a suspended ORG serves the notice on every host (the AGL-202 carrier)', async () => {
    mockGetOrgBilling.mockResolvedValue({
      org: {
        $id: 'org-1',
        suspendedAt: { seconds: 1_700_000_000 },
        suspendedReasonCode: 'billing',
        suspendedMessage: 'Payment overdue.',
      },
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.lockdown.reason).toBe('billing')
    expect(result.props.lockdown.message).toBe('Payment overdue.')
  })

  it('the legacy staff-internal suspendedReason never reaches the visitor', async () => {
    mockGetOrgBilling.mockResolvedValue({
      org: {
        $id: 'org-1',
        suspendedAt: { seconds: 1 },
        suspendedReason: 'spam network — see abuse thread',
      },
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    expect(JSON.stringify(result.props.lockdown)).not.toContain('spam network')
  })

  it('a PLATFORM lockdown outranks and serves its own notice', async () => {
    mockGetPlatformLockdown.mockResolvedValue({
      scope: 'platform',
      reason: 'maintenance',
      untilMs: Date.now() + 3_600_000,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props.maintenanceFallback).toBe(true)
    expect(result.props.lockdown.reason).toBe('maintenance')
    expect(result.props.lockdown.untilMs).toBeGreaterThan(Date.now())
  })

  it('an EXPIRED window serves normally again — no staff action, no write', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...HOST,
        suspendedAt: Date.now() - 7_200_000,
        suspendedReasonCode: 'maintenance',
        suspendedUntilMs: Date.now() - 3_600_000,
      },
      error: null,
    })
    const result: any = await loadPageData('acme', [])
    expect(result.props?.maintenanceFallback).toBeUndefined()
    expect(result.props?.lockdown).toBeUndefined()
  })
})
