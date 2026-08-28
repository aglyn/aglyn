/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * The shell applies the feature-flag gate it claims to apply (AGL-2484).
 *
 * `ConsoleExtension` is documented as "the shell owns rendering and applies
 * the feature-flag gate, so extensions cannot bypass entitlements". No code
 * did that. The plugin route computed `entitled` and handed it DOWN as a
 * prop, and the widget slot rendered every registered widget for a slot with
 * no entitlement check at all — so whether a paid feature was enforced in the
 * console came down to whether each extension remembered to read the prop.
 * `workflows-console-page.tsx` does not read it.
 *
 * The gate must fail CLOSED on refusal and OPEN on doubt, which are two
 * different defaults. `checkEntitlement(undefined)` resolves the free tier,
 * so gating on the value alone would tell a paying org its feature is not on
 * its plan for as long as the billing doc is in flight — the AGL-1380 defect,
 * across twelve surfaces. Hence the unsettled case below: while the org is
 * unready the shell may not render the surface AND may not make the claim.
 *
 * `redirects` is the flag under test because a plan genuinely decides it:
 * free says no, pro says yes. A flag that is false on every plan would let a
 * stand-in that hardcodes `false` pass every refusal case here.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

/** The org doc the console has resolved, and whether that read has settled. */
let mockOrg: Record<string, unknown> | undefined
let mockOrgReady: boolean
/** The entitlement flag the registered extension declares, if any. */
let mockFeatureFlag: string | undefined
/** Renders recorded per mount, so "did not render" is a positive assertion. */
let pageRenders: number
let widgetRenders: number

function MockPluginPage(_props: ConsolePluginPageProps) {
  pageRenders += 1
  return <div>{'plugin-page-body'}</div>
}

function MockPluginWidget() {
  widgetRenders += 1
  return <div>{'plugin-widget-body'}</div>
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // `checkEntitlement` and `resolveOrgEntitlements` stay REAL: they are the
  // verdict under test, and faking them would leave this asserting that a
  // stub was consulted.
  resolveConsolePluginPage: () => ({
    extension: { pluginId: 'demo', featureFlag: mockFeatureFlag },
    navItem: {
      label: 'Redirects',
      href: '/redirects',
      header: { title: 'Redirects' },
      Component: MockPluginPage,
    },
  }),
  listConsoleWidgets: () => [
    {
      extension: { pluginId: 'demo', featureFlag: mockFeatureFlag },
      widget: { slot: 'orgDashboard', widgetId: 'w1', Component: MockPluginWidget },
    },
  ],
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: () => ({ asString: () => '' }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: ['redirects'] }),
  useSearchParams: () => new URLSearchParams(),
  // The refusal notice carries a real `AppLink` to Billing, which reads the
  // pathname to decide whether it is the active route.
  usePathname: () => '/acme/hosts/acme-site/redirects',
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: mockOrgReady }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: ORG_ID, ready: mockOrgReady }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'acme-site',
}))

/** Chrome only — none of it sits between the entitlement and the render. */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/console-media-picker-provider.component', () => passthrough)
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page'
import PluginWidgetSlot from '../components/plugin-widget-slot.component'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

beforeEach(() => {
  mockOrg = { $id: ORG_ID, plan: 'free' }
  mockOrgReady = true
  mockFeatureFlag = 'redirects'
  pageRenders = 0
  widgetRenders = 0
})

const mountPage = () =>
  render(
    <ReleaseFlagsProvider>
      <HostPluginPage />
    </ReleaseFlagsProvider>,
  )

const mountSlot = () => render(<PluginWidgetSlot slot="orgDashboard" />)

/** The shell's own refusal notice, by the words it must say. */
const notice = () => screen.queryByText(/not included in your current plan/i)

describe('a plugin PAGE behind an entitlement flag (AGL-2484)', () => {
  it('does not render the extension for an org whose plan excludes it', async () => {
    mountPage()
    await waitFor(() => expect(notice()).toBeTruthy())
    // Not merely absent from the document — never invoked. A component that
    // rendered and then hid itself would still have run its effects.
    expect(pageRenders).toBe(0)
    expect(screen.queryByText('plugin-page-body')).toBeNull()
  })

  it('CONTROL: renders it for an org whose plan includes it', async () => {
    mockOrg = { $id: ORG_ID, plan: 'pro' }
    mountPage()
    await waitFor(() =>
      expect(screen.getByText('plugin-page-body')).toBeTruthy(),
    )
    expect(notice()).toBeNull()
  })

  it('CONTROL: renders an extension that declares no flag at all', async () => {
    mockFeatureFlag = undefined
    mountPage()
    await waitFor(() =>
      expect(screen.getByText('plugin-page-body')).toBeTruthy(),
    )
    expect(notice()).toBeNull()
  })

  it('makes no claim, and renders nothing, while the org is unsettled', async () => {
    // `checkEntitlement(undefined)` answers FREE. Reading the verdict here
    // would accuse a paying org of being unentitled for one paint.
    mockOrgReady = false
    mockOrg = undefined
    mountPage()
    await waitFor(() => expect(pageRenders).toBe(0))
    expect(notice()).toBeNull()
  })
})

describe('a plugin WIDGET behind an entitlement flag (AGL-2484)', () => {
  it('is not rendered into a slot for an unentitled org', async () => {
    mountSlot()
    await waitFor(() => expect(widgetRenders).toBe(0))
    expect(screen.queryByText('plugin-widget-body')).toBeNull()
  })

  it('CONTROL: is rendered for an entitled org', async () => {
    mockOrg = { $id: ORG_ID, plan: 'pro' }
    mountSlot()
    await waitFor(() =>
      expect(screen.getByText('plugin-widget-body')).toBeTruthy(),
    )
  })

  it('CONTROL: a widget from an unflagged extension always renders', async () => {
    mockFeatureFlag = undefined
    mountSlot()
    await waitFor(() =>
      expect(screen.getByText('plugin-widget-body')).toBeTruthy(),
    )
  })

  it('withholds the widget while the org read is unsettled', async () => {
    mockOrgReady = false
    mockOrg = undefined
    mountSlot()
    await waitFor(() => expect(widgetRenders).toBe(0))
  })
})
