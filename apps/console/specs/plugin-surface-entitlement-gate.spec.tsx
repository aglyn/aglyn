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
/**
 * The refusal copy the registered extension supplies, if any, plus whatever
 * else it cares to put on its own registration — the point of several cases
 * below is that none of it reaches the verdict.
 */
let mockUpgradeNotice: Record<string, unknown> | undefined
let mockExtensionExtras: Record<string, unknown>
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
    extension: {
      pluginId: 'demo',
      featureFlag: mockFeatureFlag,
      upgradeNotice: mockUpgradeNotice,
      ...mockExtensionExtras,
    },
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
  // The shell redirects a bare hub URL to its landing section (AGL-2501).
  // Neither surface here declares sections, so it never fires — but the
  // hook is called unconditionally, as hooks must be.
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
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
/*
 * The site role the shell resolves and hands down (AGL-2334). It reads the
 * viewer's org member document, which these specs stub nothing for — and what
 * they are about is the gate in front of a surface, not who may publish on it.
 */
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
  useHostRole: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
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
  mockUpgradeNotice = undefined
  mockExtensionExtras = {}
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

/**
 * An extension may write the refusal; it may not overturn it (AGL-2484).
 *
 * The shell's own sentence can only talk about plan tiers, and the feature
 * that prompted this — the Event Calendar — is false on every plan and sold
 * only as a per-organization add-on, so "not included in your current plan"
 * pointed refused readers at a comparison that would not have helped them.
 * The extension therefore supplies the words and which billing card to
 * scroll to.
 *
 * That is a value flowing from an extension into console chrome, which is
 * the shape AGL-2484 existed to close: enforcement must not depend on an
 * extension policing itself. What keeps this safe is WHEN it is read.
 * `resolveExtensionEntitlement` answers from the org billing doc and the
 * flag alone — it is not passed the extension — and the notice is consulted
 * only inside the branch its `blocked` answer selected. So the cases below
 * hand the gate an extension that says everything it can say in its own
 * favor and assert the surface still never mounts.
 */
describe('extension-supplied refusal copy (AGL-2484)', () => {
  const addonNotice = {
    message: 'The Event Calendar is a paid add-on ($9/mo for your whole workspace).',
    billingAnchor: 'addons',
  }

  it('is what a blocked org reads, in place of the generic sentence', async () => {
    mockUpgradeNotice = addonNotice
    mountPage()
    await waitFor(() =>
      expect(screen.getByText(/paid add-on \(\$9\/mo/i)).toBeTruthy(),
    )
    // The generic plan-tier claim is the thing being replaced, not merely
    // supplemented — a refused reader must not be told both.
    expect(notice()).toBeNull()
    expect(pageRenders).toBe(0)
  })

  it('deep-links to the billing card that actually sells it', async () => {
    mockUpgradeNotice = addonNotice
    mountPage()
    const link = await screen.findByRole('button', { name: /view add-ons/i })
    expect(link.getAttribute('href')).toBe('/acme/billing#addons')
  })

  it('CONTROL: an extension that supplies none keeps the shell sentence', async () => {
    mountPage()
    await waitFor(() => expect(notice()).toBeTruthy())
    const link = await screen.findByRole('button', { name: /view plans/i })
    expect(link.getAttribute('href')).toBe('/acme/billing')
  })

  /**
   * The derived sentence stays the floor.
   *
   * `blockedExtensionNotice` reads `PLAN_ENTITLEMENTS` and is therefore
   * right about a feature no plan grants without being told — the whole
   * reason it exists. Extension copy is an override layered on top of it,
   * not a replacement for it, so a surface whose extension says nothing must
   * still get the add-on wording rather than fall back to the plan-tier
   * sentence this replaced. `eventCalendar` is the flag that is false on
   * every plan, and no `upgradeNotice` is registered here.
   */
  it('falls back to the plan-derived add-on wording, not the old sentence', async () => {
    mockFeatureFlag = 'eventCalendar'
    mountPage()
    await waitFor(() =>
      expect(screen.getByText(/isn't included in any plan/i)).toBeTruthy(),
    )
    expect(screen.getByText(/paid add-on/i)).toBeTruthy()
    expect(notice()).toBeNull()
  })

  /**
   * The assertion this whole contract turns on. An extension that declares
   * refusal copy has been handed a channel into the console's chrome; if any
   * of it could reach the gate, the channel would be the bypass AGL-2484
   * closed. So the extension below claims entitlement every way its own
   * registration allows — a notice, an `entitled` flag, a `blocked: false` —
   * against a free org that does not hold `redirects`.
   */
  it('cannot talk its way past the gate, however it is decorated', async () => {
    mockUpgradeNotice = {
      message: 'Already included on your plan.',
      billingAnchor: 'addons',
    }
    mockExtensionExtras = {
      entitled: true,
      blocked: false,
      entitlement: 'entitled',
      upgradeNotice: {
        message: 'Already included on your plan.',
        billingAnchor: 'addons',
      },
    }
    mountPage()
    // Refused, and refused BEFORE the component exists: a surface that
    // mounted and then hid itself would already have run its effects and
    // opened its listeners.
    await waitFor(() =>
      expect(screen.getByText('Already included on your plan.')).toBeTruthy(),
    )
    expect(pageRenders).toBe(0)
    expect(screen.queryByText('plugin-page-body')).toBeNull()
  })

  /**
   * The other half: the extension names WHERE to link, so an unvalidated
   * value would be an open redirect rendered by the console's own chrome.
   * It supplies a fragment id, never a URL, and one the console does not
   * recognize degrades to the plain Billing link.
   */
  it('cannot move the link off the console billing route', async () => {
    mockUpgradeNotice = {
      message: 'Renew now.',
      billingAnchor: 'https://phish.example/billing',
    }
    mountPage()
    const link = await screen.findByRole('button', { name: /view plans/i })
    expect(link.getAttribute('href')).toBe('/acme/billing')
    expect(link.getAttribute('href')).not.toContain('phish.example')
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
