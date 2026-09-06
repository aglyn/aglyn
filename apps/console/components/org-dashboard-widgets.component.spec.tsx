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
 * THE GATE IN FRONT OF THE ORGANIZATION'S DASHBOARD ROW (AGL-2636).
 *
 * The row is the one console surface that drops a plugin card reading
 * ACROSS the host boundary onto a page every member of the org can open.
 * What this pins is that nothing mounts — not a grid, not a card, not a
 * listener — for anyone the org CRM hub would refuse, and that for the
 * reader it admits the card mounts AT ONCE, with the org mount and no site,
 * without waiting on a dashboard arrangement the sites page never reads.
 *
 * ⛔ The slot is REAL. `PluginWidgetSlot` and `useSlotWidgets` run unmocked
 * over the real extension registry, so the enablement, entitlement and
 * permission gates every slot composes are exercised, not assumed; only the
 * hooks that would open Firestore listeners are answered by hand.
 */

import {
  CONSOLE_WIDGET_SLOTS,
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginOrgMount,
  type OrgPermission,
} from '@aglyn/aglyn'
import { render } from '@testing-library/react'

/** What the hooks answer, set per case. */
let mockReach = { orgWide: true, ready: true }
let mockPermissions = {
  granted: new Set<string>(['data.manage']),
  loaded: true,
  errored: false,
}

jest.mock('../hooks/use-org-reach', () => ({
  __esModule: true,
  useOrgReach: () => mockReach,
  default: () => mockReach,
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    can: (permission: OrgPermission) => mockPermissions.granted.has(permission),
    permissions: {},
    loaded: mockPermissions.loaded,
    errored: mockPermissions.errored,
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: {}, orgId: 'org-1', ready: true }),
}))
jest.mock('./console-plugins-gate.component', () => ({
  useEnabledPluginIds: () => ['probe', 'gated-probe'],
}))

import { OrgDashboardWidgets } from './org-dashboard-widgets.component'

const MOUNT: ConsolePluginOrgMount = {
  orgId: 'org-1',
  hosts: [{ id: 'h-1', name: 'Demo', subdomain: 'demo' }],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

/** A card that reports exactly what the slot handed it. */
function ProbeCard(props: {
  hostId: string | null
  basePath?: string
  orgMount?: ConsolePluginOrgMount
}) {
  return (
    <article data-testid="probe">
      {`${props.hostId === null ? 'no site' : props.hostId}|${props.basePath}|${
        props.orgMount?.orgId
      }|${props.orgMount?.hosts.length}`}
    </article>
  )
}
ProbeCard.displayName = 'ProbeCard'

function GatedCard() {
  return <article data-testid="gated">{'gated'}</article>
}
GatedCard.displayName = 'GatedCard'

beforeEach(() => {
  mockReach = { orgWide: true, ready: true }
  mockPermissions = { granted: new Set(['data.manage']), loaded: true, errored: false }
  registerConsoleExtension({
    pluginId: 'probe' as never,
    displayName: 'Probe',
    widgets: [
      {
        slot: CONSOLE_WIDGET_SLOTS.orgDashboard,
        widgetId: 'probe-card',
        Component: ProbeCard,
      },
    ],
  })
  // A second plugin whose widget needs a permission this reader lacks: the
  // slot's own gate, composed under the row's.
  registerConsoleExtension({
    pluginId: 'gated-probe' as never,
    displayName: 'Gated probe',
    permission: 'billing.manage',
    widgets: [
      {
        slot: CONSOLE_WIDGET_SLOTS.orgDashboard,
        widgetId: 'gated-card',
        Component: GatedCard,
      },
    ],
  })
})
afterEach(() => {
  unregisterConsoleExtension('probe' as never)
  unregisterConsoleExtension('gated-probe' as never)
})

const draw = (mount: ConsolePluginOrgMount | undefined) =>
  render(<OrgDashboardWidgets orgMount={mount} basePath="/acme/crm" />)

describe('OrgDashboardWidgets', () => {
  it('mounts the slot at once for an org-wide member with the permission: no site, the mount, the hub path', () => {
    const { queryByTestId } = draw(MOUNT)
    // Synchronously — the row never holds on a dashboard arrangement.
    expect(queryByTestId('probe')?.textContent).toBe('no site|/acme/crm|org-1|1')
    // The slot's own permission gate still composes beneath the row's.
    expect(queryByTestId('gated')).toBeNull()
  })

  it('renders nothing for a site collaborator, whatever permission they hold', () => {
    mockReach = { orgWide: false, ready: true }
    const { container } = draw(MOUNT)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing until reach has settled — the frame a collaborator could screenshot', () => {
    mockReach = { orgWide: true, ready: false }
    const { container } = draw(MOUNT)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing while the member document is in flight, and nothing when it failed', () => {
    mockPermissions = { granted: new Set(['data.manage']), loaded: false, errored: false }
    expect(draw(MOUNT).container.innerHTML).toBe('')
    mockPermissions = { granted: new Set(['data.manage']), loaded: false, errored: true }
    expect(draw(MOUNT).container.innerHTML).toBe('')
  })

  it('renders nothing for an org-wide member without the CRM permission', () => {
    mockPermissions = { granted: new Set(['content.edit']), loaded: true, errored: false }
    const { container } = draw(MOUNT)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing — no grid, no gap — when no widget survives the gates', () => {
    unregisterConsoleExtension('probe' as never)
    const { container } = draw(MOUNT)
    expect(container.innerHTML).toBe('')
  })

  it('holds until the workspace has resolved into a mount', () => {
    const { container } = draw(undefined)
    expect(container.innerHTML).toBe('')
  })
})
