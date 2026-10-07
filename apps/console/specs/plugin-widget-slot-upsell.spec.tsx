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
 * A widget that is its own upsell (AGL-3601): `showWhenNotEntitled`.
 *
 * The shell mounts it with `entitled={false}` and its own billing link ONLY
 * where the plan entitlement is the one thing missing and an add-on this
 * workspace can buy would grant it. Every other gate — the reader's
 * permission, the plugin being on for the workspace and the site, a plan with
 * nothing to buy — still leaves it absent, and a widget that did not opt in
 * keeps the old treatment.
 *
 * The permission resolution, the entitlement resolver and the release-flag
 * defaults are the real ones; only Firestore, the org read and the registry
 * are doubles, so each verdict is changed by editing a DOCUMENT.
 */

import { render, screen, waitFor } from '@testing-library/react'

let mockMemberDoc: Record<string, unknown>
let mockOrg: Record<string, unknown>
let mockEnabled: string[]
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

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
  useOrgSlug: () => 'acme',
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))

jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  // Stands for the workspace's AND the site's switches: a site whose admin
  // switched the plugin off subtracts it here (AGL-1014).
  useEnabledPluginIds: () => mockEnabled,
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

import {
  AI_ADDON_CREDITS_PER_MONTH,
  registerPluginEntitlements,
  resetPluginEntitlementsForTests,
} from '@aglyn/aglyn'
import PluginWidgetSlot from '../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../constants/route-links'
import { OrgPermissionsProvider } from '../hooks/use-org-permissions'

const widgetComponent = (id: string) => (props: Record<string, unknown>) => {
  received[id] = props
  return <div>{`widget-${id}`}</div>
}

const registerWidget = (options: {
  id: string
  featureFlag?: string
  permission?: string
  optIn?: boolean
}) => {
  mockRegistered.push({
    extension: { pluginId: 'demo', displayName: 'Demo' },
    widget: {
      slot: 'hostScreens',
      widgetId: options.id,
      featureFlag: options.featureFlag ?? 'demoUpsell',
      permission: options.permission,
      ...(options.optIn === false ? {} : { showWhenNotEntitled: true }),
      Component: widgetComponent(options.id),
    },
  })
}

/** Renders the zone, then a sentinel that proves the member read applied. */
async function mountZone() {
  render(
    <OrgPermissionsProvider>
      <PluginWidgetSlot slot="hostScreens" hostId="h1" orgId="org-1" />
      <PluginWidgetSlot slot="hostTemplates" hostId="h1" orgId="org-1" />
    </OrgPermissionsProvider>,
  )
  await waitFor(() => expect(screen.getByText('widget-control')).toBeTruthy())
}

const BILLING_ADDONS = `${buildRoute(Route.MANAGE_BILLING, { orgSlug: 'acme' })}#addons`

beforeAll(() => {
  registerPluginEntitlements({
    pluginId: 'demo',
    seatAddons: [
      {
        key: 'demoUpsellAddon',
        label: 'Demo add-on',
        maxUnits: 1,
        quota: { key: 'demoUpsellQuota', perUnitByPlan: AI_ADDON_CREDITS_PER_MONTH },
        features: ['demoUpsell'],
      },
    ],
  })
})
afterAll(() => resetPluginEntitlementsForTests())

beforeEach(() => {
  mockMemberDoc = { role: 'owner' }
  mockOrg = { $id: 'org-1', plan: 'pro', billingStatus: 'active' }
  mockEnabled = ['demo']
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

describe('a widget that is its own upsell', () => {
  it('is mounted with entitled false and the add-ons link when only the plan lacks it', async () => {
    registerWidget({ id: 'ai', permission: 'data.manage' })
    await mountZone()
    expect(screen.getByText('widget-ai')).toBeTruthy()
    expect(received['ai']).toEqual(
      expect.objectContaining({
        hostId: 'h1',
        orgId: 'org-1',
        entitled: false,
        upgrade: { billingHref: BILLING_ADDONS, canManageBilling: true },
      }),
    )
  })

  it('tells it the reader cannot buy it when their role lacks billing.manage', async () => {
    mockMemberDoc = { role: 'editor' }
    registerWidget({ id: 'ai', permission: 'data.manage' })
    await mountZone()
    expect(received['ai']).toEqual(
      expect.objectContaining({
        entitled: false,
        upgrade: { billingHref: BILLING_ADDONS, canManageBilling: false },
      }),
    )
  })

  it('is mounted with entitled true, and no link, when the plan includes it', async () => {
    mockOrg = { ...mockOrg, entitlements: { features: { demoUpsell: true } } }
    registerWidget({ id: 'ai' })
    await mountZone()
    expect(received['ai']).toEqual(expect.objectContaining({ entitled: true }))
    expect(received['ai']['upgrade']).toBeUndefined()
  })

  it('stays absent for a reader without the widget’s permission', async () => {
    mockMemberDoc = { role: 'viewer' }
    registerWidget({ id: 'ai', permission: 'billing.view' })
    // The sentinel needs a key a viewer holds for this case.
    mockRegistered[0].widget['permission'] = undefined
    await mountZone()
    expect(screen.queryByText('widget-ai')).toBeNull()
    expect(received['ai']).toBeUndefined()
  })

  it('stays absent where the plugin is switched off for the site', async () => {
    registerWidget({ id: 'ai' })
    mockRegistered.push({
      extension: { pluginId: 'other', displayName: 'Other' },
      widget: { ...mockRegistered[1].widget, widgetId: 'off' },
    })
    mockRegistered[2].widget['Component'] = widgetComponent('off')
    await mountZone()
    expect(screen.getByText('widget-ai')).toBeTruthy()
    expect(received['off']).toBeUndefined()
  })

  it('stays absent on a plan the add-on is not sold on', async () => {
    mockOrg = { $id: 'org-1', plan: 'free' }
    registerWidget({ id: 'ai' })
    await mountZone()
    expect(received['ai']).toBeUndefined()
  })

  it('stays absent on a paid plan with no live subscription to add it to', async () => {
    mockOrg = { $id: 'org-1', plan: 'pro', billingStatus: 'canceled' }
    registerWidget({ id: 'ai' })
    await mountZone()
    expect(received['ai']).toBeUndefined()
  })

  it('stays absent when the missing flag is sold by no add-on', async () => {
    registerWidget({ id: 'ai', featureFlag: 'demoPlanOnly' })
    await mountZone()
    expect(received['ai']).toBeUndefined()
  })

  it('CONTROL: a widget that did not opt in keeps the old treatment, and its props', async () => {
    registerWidget({ id: 'plain', optIn: false })
    registerWidget({ id: 'plain-ok', optIn: false, featureFlag: undefined })
    mockRegistered[2].widget['featureFlag'] = undefined
    await mountZone()
    expect(received['plain']).toBeUndefined()
    expect(received['plain-ok']).toEqual({ hostId: 'h1', orgId: 'org-1' })
  })
})
