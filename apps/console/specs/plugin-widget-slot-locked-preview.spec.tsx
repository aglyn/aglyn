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
 * A widget that declares `lockedPreview` (AGL-3977).
 *
 * Where the only thing missing is a feature a higher plan includes, the shell
 * draws a locked card in its place — the widget's title, what it does,
 * "Included from {plan}" and an Upgrade link to the plan grid — and never
 * mounts the widget itself. Every other gate still leaves it absent, a
 * feature no plan carries stays absent, and a paid plan gets the real widget.
 *
 * The permission resolution, the entitlement resolver and the plan tables are
 * the real ones; only Firestore, the org read and the registry are doubles.
 */

import { render, screen, waitFor } from '@testing-library/react'

let mockMemberDoc: Record<string, unknown>
let mockOrg: Record<string, unknown>
let mockOrgReady: boolean
let mockRegistered: Array<{
  extension: Record<string, unknown>
  widget: Record<string, unknown>
}>
/** The props each widget was last constructed with. */
let received: Record<string, Record<string, unknown>>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async () => ({
    exists: () => true,
    data: () => mockMemberDoc,
    get: (key: string) => (mockMemberDoc as never)?.[key],
  }),
}))

const FIRESTORE = {}
const USER = { uid: 'u1' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: USER }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts/site',
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
  useOrgSlug: () => 'acme',
}))

jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: mockOrgReady }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: 'org-1', ready: mockOrgReady }),
}))

jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  listConsoleWidgets: (slot: string, enabled: readonly string[]) =>
    mockRegistered.filter(
      (entry) =>
        entry.widget['slot'] === slot &&
        enabled.includes(String(entry.extension['pluginId'])),
    ),
}))

import PluginWidgetSlot from '../components/plugin-widget-slot.component'
import { OrgPermissionsProvider } from '../hooks/use-org-permissions'

const widgetComponent = (id: string) => (props: Record<string, unknown>) => {
  received[id] = props
  return <div>{`widget-${id}`}</div>
}

const registerWidget = (options: {
  id: string
  featureFlag?: string
  permission?: string
  locked?: boolean
}) => {
  mockRegistered.push({
    extension: { pluginId: 'demo', displayName: 'Demo' },
    widget: {
      slot: 'hostDashboard',
      widgetId: options.id,
      title: `Card ${options.id}`,
      featureFlag: options.featureFlag ?? 'crm',
      permission: options.permission,
      ...(options.locked === false
        ? {}
        : { lockedPreview: { description: `What ${options.id} does.` } }),
      Component: widgetComponent(options.id),
    },
  })
}

/** Renders the zone, then a sentinel that proves the member read applied. */
async function mountZone() {
  render(
    <OrgPermissionsProvider>
      <PluginWidgetSlot slot="hostDashboard" hostId="h1" />
      <PluginWidgetSlot slot="hostTemplates" hostId="h1" />
    </OrgPermissionsProvider>,
  )
  await waitFor(() => expect(screen.getByText('widget-control')).toBeTruthy())
}

beforeEach(() => {
  mockMemberDoc = { role: 'owner' }
  mockOrg = { $id: 'org-1', plan: 'free' }
  mockOrgReady = true
  mockRegistered = []
  received = {}
  // The sentinel: an ungated widget on a second zone, drawn once the member
  // read has applied, so an absence below is the gate's and not the wait's.
  mockRegistered.push({
    extension: { pluginId: 'demo', displayName: 'Demo' },
    widget: {
      slot: 'hostTemplates',
      widgetId: 'control',
      permission: 'data.manage',
      Component: widgetComponent('control'),
    },
  })
})

describe('a widget with a locked preview', () => {
  it('is drawn locked on Free — its title, what it does, the plan, and the plan grid', async () => {
    registerWidget({ id: 'glance' })
    await mountZone()
    expect(screen.getByText('Card glance')).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('What glance does.')
    expect(alert.textContent).toContain('Included from Starter.')
    expect(screen.getByRole('button', { name: 'Upgrade' }).getAttribute('href')).toBe(
      '/acme/billing#plans',
    )
    // The widget itself never mounted, so it read nothing the plan refuses.
    expect(received['glance']).toBeUndefined()
  })

  it('is the real widget on a plan that includes it', async () => {
    mockOrg = { $id: 'org-1', plan: 'starter', billingStatus: 'active' }
    registerWidget({ id: 'glance' })
    await mountZone()
    expect(screen.getByText('widget-glance')).toBeTruthy()
    expect(screen.queryByText('Included from Starter.', { exact: false })).toBeNull()
  })

  it('stays absent while the plan is still loading', async () => {
    mockOrgReady = false
    registerWidget({ id: 'glance' })
    mockRegistered[0].widget['permission'] = undefined
    render(
      <OrgPermissionsProvider>
        <PluginWidgetSlot slot="hostDashboard" hostId="h1" />
      </OrgPermissionsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('Card glance')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stays absent for a reader without the widget’s permission', async () => {
    mockMemberDoc = { role: 'viewer' }
    registerWidget({ id: 'glance', permission: 'billing.view' })
    mockRegistered[0].widget['permission'] = undefined
    await mountZone()
    expect(screen.queryByText('Card glance')).toBeNull()
  })

  it('stays absent when no plan includes the missing feature', async () => {
    registerWidget({ id: 'seq', featureFlag: 'outreach' })
    await mountZone()
    expect(screen.queryByText('Card seq')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('CONTROL: a widget without a locked preview keeps the old treatment', async () => {
    registerWidget({ id: 'plain', locked: false })
    await mountZone()
    expect(screen.queryByText('Card plain')).toBeNull()
    expect(received['plain']).toBeUndefined()
  })
})
