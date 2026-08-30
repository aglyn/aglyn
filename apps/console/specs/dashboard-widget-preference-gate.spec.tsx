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
 * A stored preference chooses among entitled widgets; it never produces one.
 *
 * Letting someone arrange their dashboard puts a value the READER controls
 * into the path that decides what renders, which is the shape AGL-2484
 * existed to close on the extension side. What keeps it safe is the order of
 * operations: `useSlotWidgets` answers from the enabled plugin set and the
 * org's billing doc alone, and the preference is applied strictly to its
 * output, where it can only subtract. So the cases below hand the slot a
 * preference that says everything it can say in favor of a card the org does
 * not hold, and assert the card still never mounts.
 *
 * `redirects` is the flag under test because a plan genuinely decides it:
 * free says no, pro says yes. A flag false on every plan would let a stand-in
 * that hardcodes `false` pass every refusal here.
 */

import { render, screen, waitFor } from '@testing-library/react'

const ORG_ID = 'org-1'

/** The org doc the console has resolved, and whether that read has settled. */
let mockOrg: Record<string, unknown> | undefined
let mockOrgReady: boolean
/** The entitlement flag the registered extension declares, if any. */
let mockFeatureFlag: string | undefined
/** The whole `dashboardWidgets` map `users/{uid}` holds, keyed by org. */
let mockStoredWidgetsField: unknown
/** Renders recorded per mount, so "did not render" is a positive assertion. */
let widgetRenders: number

function MockPaidWidget() {
  widgetRenders += 1
  return <div>{'paid-widget-body'}</div>
}

function MockFreeWidget() {
  return <div>{'free-widget-body'}</div>
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // `checkEntitlement` and `resolveOrgEntitlements` stay REAL: they are the
  // verdict under test, and faking them would leave this asserting that a
  // stub was consulted.
  listConsoleWidgets: (slot: string) =>
    slot !== 'hostDashboard'
      ? []
      : [
          {
            extension: {
              pluginId: 'paid',
              displayName: 'Paid',
              featureFlag: mockFeatureFlag,
            },
            widget: {
              slot,
              widgetId: 'paid-card',
              title: 'Paid card',
              Component: MockPaidWidget,
            },
          },
          {
            extension: { pluginId: 'free', displayName: 'Free' },
            widget: {
              slot,
              widgetId: 'free-card',
              title: 'Free card',
              Component: MockFreeWidget,
            },
          },
        ],
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: () => ({}),
  getDoc: async () => ({
    get: (field: string) =>
      field === 'dashboardWidgets' ? mockStoredWidgetsField : undefined,
  }),
  setDoc: async () => undefined,
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: mockOrgReady }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: ORG_ID, ready: mockOrgReady }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['paid', 'free'],
}))

import DashboardWidgetPrefsProvider from '../components/dashboard-widget-prefs.context'
import PluginWidgetSlot from '../components/plugin-widget-slot.component'

beforeEach(() => {
  mockOrg = { $id: ORG_ID, plan: 'free' }
  mockOrgReady = true
  mockFeatureFlag = 'redirects'
  mockStoredWidgetsField = undefined
  widgetRenders = 0
})

const mountDashboardSlot = () =>
  render(
    <DashboardWidgetPrefsProvider>
      <PluginWidgetSlot slot="hostDashboard" />
    </DashboardWidgetPrefsProvider>,
  )

const paid = () => screen.queryByText('paid-widget-body')
const free = () => screen.queryByText('free-widget-body')

describe('the entitlement gate outranks the stored preference', () => {
  it('CONTROL: an entitled widget renders when nothing hides it', async () => {
    mockOrg = { $id: ORG_ID, plan: 'pro' }
    mountDashboardSlot()
    await waitFor(() => expect(paid()).toBeTruthy())
    expect(widgetRenders).toBe(1)
  })

  it('does NOT render a widget the org is not entitled to, however the stored preference is written', async () => {
    // The assertion the whole feature turns on. The preference below says
    // show it every way its own storage allows — absent from `hidden`, first
    // in the rank — against a free org that does not hold `redirects`.
    mockStoredWidgetsField = { [ORG_ID]: { hidden: [], order: ['paid-card', 'free-card'] } }
    mountDashboardSlot()
    // Settled on the slot's answer before asserting an absence, so this
    // cannot pass merely by reading the page before the preference arrives.
    await waitFor(() => expect(free()).toBeTruthy())
    expect(paid()).toBeNull()
    // Not merely absent from the document — never invoked. A component that
    // rendered and then hid itself would already have run its effects.
    expect(widgetRenders).toBe(0)
  })

  it('does not resurrect a widget an org has LOST by leaving it unhidden', async () => {
    // The stale-preference direction: the arrangement was written while the
    // org held the plan, so the paid card sits in the rank and outside
    // `hidden`. Downgrading must take the card away regardless.
    mockStoredWidgetsField = { [ORG_ID]: { hidden: ['free-card'], order: ['paid-card'] } }
    mountDashboardSlot()
    await waitFor(() => expect(screen.queryByText(/widget-body/)).toBeNull())
    expect(widgetRenders).toBe(0)
  })

  it('CONTROL: the same preference shows the card once the plan grants it', async () => {
    // Guard the guard: the two refusals above would also hold if the stored
    // rank had simply broken rendering outright.
    mockOrg = { $id: ORG_ID, plan: 'pro' }
    mockStoredWidgetsField = { [ORG_ID]: { hidden: ['free-card'], order: ['paid-card'] } }
    mountDashboardSlot()
    await waitFor(() => expect(paid()).toBeTruthy())
    expect(free()).toBeNull()
  })
})

describe('a preference is a choice among widgets, not a source of them', () => {
  it('renders nothing for a ranked id that names no registered widget', async () => {
    mockStoredWidgetsField = { [ORG_ID]: { hidden: [], order: ['ghost-card', 'free-card'] } }
    mountDashboardSlot()
    await waitFor(() => expect(free()).toBeTruthy())
    expect(screen.queryByText(/ghost/)).toBeNull()
  })

  it('shows a widget no stored preference mentions', async () => {
    // The allowlist trap, through the real slot: someone who customized
    // before this plugin existed must still be shown its card.
    mockFeatureFlag = undefined
    mockStoredWidgetsField = { [ORG_ID]: { hidden: ['some-card-from-2025'], order: ['another-old-card'] } }
    mountDashboardSlot()
    await waitFor(() => expect(free()).toBeTruthy())
    expect(paid()).toBeTruthy()
  })

  it('THE CONTROL: hiding an entitled widget really does remove it', async () => {
    mockFeatureFlag = undefined
    mockStoredWidgetsField = { [ORG_ID]: { hidden: ['paid-card'], order: [] } }
    mountDashboardSlot()
    await waitFor(() => expect(free()).toBeTruthy())
    expect(paid()).toBeNull()
    expect(widgetRenders).toBe(0)
  })
})

describe('the slot outside a provider is unchanged', () => {
  it('renders entitled widgets with no preference read at all', async () => {
    // Every other console surface mounting this slot has no dashboard
    // provider above it. It must neither filter nor fetch — the preference
    // exists on one page, and a user-document read on a dozen is the cost
    // this design exists to avoid.
    mockFeatureFlag = undefined
    render(<PluginWidgetSlot slot="hostDashboard" />)
    await waitFor(() => expect(free()).toBeTruthy())
    expect(paid()).toBeTruthy()
  })

  it('is not held behind a preference that will never arrive', () => {
    // Synchronous on the first paint: outside a provider `ready` is a
    // constant, so nothing here waits on a read that is never made.
    mockFeatureFlag = undefined
    render(<PluginWidgetSlot slot="hostDashboard" />)
    expect(free()).toBeTruthy()
  })
})
