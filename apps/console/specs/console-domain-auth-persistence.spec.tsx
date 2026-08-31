/**
 * @jest-environment jsdom
 */

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
 * AGL-1099c — the declaration, not the mechanism.
 *
 * Three pieces were built for a custom console domain and every one of them
 * defaulted to safe-for-`*.aglyn.com`:
 *
 * - `createAuthInstance` (AGL-1379) — `inMemoryPersistence` plus a sealed
 *   `setPersistence`, on `ephemeral`.
 * - `localCacheFor` (AGL-1456) — `memoryLocalCache()`, on `ephemeral`.
 * - `FirebaseServicesProvider`'s `authPersistence` prop, which selects both.
 *
 * All three were tested. **None was ever reached**, because no call site
 * passed the prop, so the console ran `durable` on every origin including the
 * one the whole feature exists to protect. That is the AGL-1354 shape — a
 * guard that exists and is never reached — and
 * `auth-persistence-provider.spec.tsx` could not catch it, because it mounts
 * the provider itself and hands it the prop by hand.
 *
 * This file asserts the edge nothing else covers: **the console's real layout
 * passes the class the origin dictates.** The host→class mapping is
 * `workspace-domain.spec.ts`'s job; the browser read on a real custom domain
 * is `console-domain-auth-persistence-custom-host.spec.ts`'s, which needs its
 * own jsdom URL and therefore its own file.
 *
 * `FirebaseAppLayout` takes no hooks — it destructures `props` and returns
 * JSX — so it is called directly and its element tree is read. Rendering it
 * would drag in the analytics/session subtree, and every assertion would then
 * depend on mocks that have nothing to do with persistence, which is how a
 * test comes to fail for reasons it does not name.
 */

import type { ReactElement, ReactNode } from 'react'

/**
 * A CLOSED WORLD. The layout module is imported for real; everything it
 * imports that would do work at import time, or reach the network, is stubbed
 * here. `FirebaseServicesProvider` is stubbed to a recognisable identity
 * rather than a behaviour — this file never renders it, it only needs to find
 * it in the tree and read the prop it was handed.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  fbClientAppOptions: { projectId: 'aglyn-main' },
  FIREBASE_CLIENT_APP_NAME: 'console',
  FirebaseServicesProvider: function FirebaseServicesProvider() {
    return null
  },
  setFirestoreSessionReporters: jest.fn(),
  setStaleSessionCheck: jest.fn(),
  // The layout registers its visitor-consent gate at module scope, beside the
  // two seams above, so importing it at all requires this to exist.
  setAnalyticsConsentGate: jest.fn(),
  useAnalytics: () => ({}),
  useUser: () => ({ data: null }),
}))

jest.mock('@mui/material', () => ({
  __esModule: true,
  NoSsr: ({ children }: { children: ReactNode }) => children,
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  configureAnalyticsTransport: jest.fn(),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-environment', () => ({
  __esModule: true,
  analyticsEnvironmentForcesInternal: () => false,
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  logEvent: jest.fn(),
  setUserId: jest.fn(),
  setUserProperties: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/',
}))

const passthrough = () =>
  function Passthrough({ children }: { children?: ReactNode }) {
    return children ?? null
  }

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  OrgScopeProvider: passthrough(),
}))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  ReleaseFlagsProvider: passthrough(),
}))
jest.mock('../hooks/use-url-names-org', () => ({
  __esModule: true,
  useUrlNamedOrg: () => undefined,
}))
jest.mock('../hooks/use-org-plans', () => ({
  __esModule: true,
  useOrgPlans: () => ({}),
}))
jest.mock('../hooks/use-session-cookie', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('../components/boot-splash.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../utils/analytics-user-properties', () => ({
  __esModule: true,
  buildOrgUserProperties: () => ({}),
}))
jest.mock('../utils/page-view-params', () => ({
  __esModule: true,
  buildPageViewParams: () => ({}),
  consumePendingPageViewParams: () => ({}),
}))
jest.mock('../utils/analytics-default-params', () => ({
  __esModule: true,
  setAnalyticsDefaultParams: jest.fn(),
}))
jest.mock('../utils/session-health', () => ({
  __esModule: true,
  reportFirestoreSessionDenial: jest.fn(),
  startSessionHealthWatch: jest.fn(),
  stopSessionHealthWatch: jest.fn(),
}))
jest.mock('../utils/session-heal', () => ({
  __esModule: true,
  watchSessionHeal: jest.fn(),
}))
jest.mock('../utils/internal-traffic', () => ({
  __esModule: true,
  markInternalTraffic: jest.fn(),
  resolveInternalTraffic: () => false,
}))

import { FirebaseServicesProvider } from '@aglyn/tenant-feature-instance'
// A namespace import so the seam can be spied. NOT mocked with a factory:
// the last case in this file runs the REAL function, and a factory mock
// would leave nothing to run.
import * as workspaceDomain from '../constants/workspace-domain'
import FirebaseAppLayout from '../components/layouts/firebase-app.layout'

/**
 * The `authPersistence` the layout hands `FirebaseServicesProvider`.
 *
 * Walks the returned tree rather than assuming a depth, so wrapping the
 * provider in another element does not silently turn this green.
 */
function declaredPersistence(): unknown {
  const tree = FirebaseAppLayout({ children: null }) as ReactElement
  const seen: unknown[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const element = node as ReactElement
    if (element.type === FirebaseServicesProvider) {
      seen.push((element.props as Record<string, unknown>).authPersistence)
    }
    if (element.props) visit((element.props as { children?: unknown }).children)
  }
  visit(tree)
  // Exactly one provider, or the question is ambiguous and the answer below
  // would be a coin flip.
  expect(seen).toHaveLength(1)
  return seen[0]
}

describe('the console declares its origin class to FirebaseServicesProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  /**
   * Both directions, because only one of them would otherwise be a
   * coincidence: under this file's jsdom the real origin is `localhost`, so a
   * layout that hard-coded `durable` — or that dropped the prop entirely and
   * let the default supply it — would satisfy a `durable` assertion on its
   * own.
   */
  it('forwards ephemeral when the origin says ephemeral', () => {
    jest
      .spyOn(workspaceDomain, 'currentOriginPersistenceClass')
      .mockReturnValue('ephemeral')

    expect(declaredPersistence()).toBe('ephemeral')
  })

  it('forwards durable when the origin says durable', () => {
    jest
      .spyOn(workspaceDomain, 'currentOriginPersistenceClass')
      .mockReturnValue('durable')

    expect(declaredPersistence()).toBe('durable')
  })

  it('passes the prop at all — undefined is never the answer', () => {
    // The regression this whole file exists for. `authPersistence` is
    // OPTIONAL and defaults to `durable`, so deleting the prop breaks nothing
    // any other test observes: the console keeps working on every host we
    // own, and only the custom domain — which has no live traffic yet — is
    // silently unprotected.
    expect(declaredPersistence()).toBeDefined()
  })

  it('really reads the browser origin — localhost is durable', () => {
    // No spy: the REAL function against this file's real jsdom origin
    // (`http://localhost/`). If it read nothing — a typo'd property, an
    // off-browser guard that always fired — the polarity would hand back
    // `ephemeral`, so this asserting `durable` is what proves the read
    // happens at all.
    expect(workspaceDomain.currentOriginPersistenceClass()).toBe('durable')
    expect(window.location.host).toBe('localhost')
  })

  it('agrees with the pure mapping for the same host', () => {
    expect(workspaceDomain.currentOriginPersistenceClass()).toBe(
      workspaceDomain.originPersistenceClass(window.location.host),
    )
  })
})
