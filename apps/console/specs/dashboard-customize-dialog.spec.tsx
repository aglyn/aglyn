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
 * The dialog that arranges the dashboard, driven the way a person drives it.
 *
 * Two things it can get wrong that nothing else would catch: offering a
 * switch for a card the org cannot have (a control that appears broken), and
 * writing an arrangement under a shape the reader will not be given back.
 * Both are assertions about what reaches Firestore, so this drives the form
 * and reads the write rather than calling the reducers directly — those have
 * their own spec, and passing there would not have caught either.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const ORG_ID = 'org-1'

let mockOrg: Record<string, unknown> | undefined
/** The flag the paid extension declares; `undefined` makes it ungated. */
let mockFeatureFlag: string | undefined
let mockStoredWidgetsField: unknown
/** Every `setDoc` payload, in order. */
let mockWrites: Array<Record<string, unknown>>

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
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
              Component: () => <div>{'paid-widget-body'}</div>,
            },
          },
          {
            extension: { pluginId: 'free', displayName: 'Free plugin' },
            // No `title`, so this also covers the fallback to the
            // extension's own name rather than a raw id in the list.
            widget: {
              slot,
              widgetId: 'free-card',
              Component: () => <div>{'free-widget-body'}</div>,
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
  setDoc: async (_ref: unknown, data: Record<string, unknown>) => {
    mockWrites.push(data)
  },
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['paid', 'free'],
}))

import DashboardCustomizeButton from '../components/dashboard-customize-button.component'
import DashboardWidgetPrefsProvider from '../components/dashboard-widget-prefs.context'

beforeEach(() => {
  mockOrg = { $id: ORG_ID, plan: 'pro' }
  mockFeatureFlag = 'redirects'
  mockStoredWidgetsField = undefined
  mockWrites = []
})

const openDialog = async () => {
  render(
    <DashboardWidgetPrefsProvider>
      <DashboardCustomizeButton />
    </DashboardWidgetPrefsProvider>,
  )
  fireEvent.click(screen.getByLabelText('customize dashboard'))
  await screen.findByText('Customize dashboard')
}

/** The arrangement the last write would store for this org. */
const lastStored = () => {
  const write = mockWrites[mockWrites.length - 1]
  return (write?.dashboardWidgets as Record<string, unknown>)?.[ORG_ID]
}

describe('what the dialog offers', () => {
  it('lists the console’s own card beside the plugins’ cards', async () => {
    await openDialog()
    // `Traffic` is not in the widget registry — no plugin owns site analytics
    // and no entitlement gates it — but it is a dashboard card, so it is
    // hideable like the rest.
    expect(await screen.findByLabelText('show Traffic')).toBeTruthy()
    expect(screen.getByLabelText('show Paid card')).toBeTruthy()
  })

  it('names an untitled widget after the plugin that registered it', async () => {
    await openDialog()
    expect(await screen.findByLabelText('show Free plugin')).toBeTruthy()
  })

  it('offers NO switch for a card the org is not entitled to', async () => {
    // A row here would be a control that appears to do nothing: the slot
    // would refuse the card whatever the switch said.
    mockOrg = { $id: ORG_ID, plan: 'free' }
    await openDialog()
    expect(await screen.findByLabelText('show Free plugin')).toBeTruthy()
    expect(screen.queryByLabelText('show Paid card')).toBeNull()
  })
})

describe('what the dialog writes', () => {
  it('stores the widget id under this workspace, merged', async () => {
    await openDialog()
    fireEvent.click(await screen.findByLabelText('show Paid card'))
    await waitFor(() => expect(mockWrites.length).toBe(1))
    expect(lastStored()).toEqual({ hidden: ['paid-card'], order: [] })
  })

  it('does not touch another workspace’s arrangement', async () => {
    // One map keyed by org id, written per key: an agency member arranging
    // one client's dashboard must not restate the other five.
    await openDialog()
    fireEvent.click(await screen.findByLabelText('show Paid card'))
    await waitFor(() => expect(mockWrites.length).toBe(1))
    expect(Object.keys(mockWrites[0].dashboardWidgets as object)).toEqual([
      ORG_ID,
    ])
  })

  it('lets every card be switched off — the last one included', async () => {
    // Hiding is a preference, not a limit. Nothing here refuses or ejects,
    // and an empty dashboard is a choice a person may make.
    await openDialog()
    for (const label of ['show Traffic', 'show Paid card', 'show Free plugin']) {
      fireEvent.click(await screen.findByLabelText(label))
    }
    await waitFor(() => expect(mockWrites.length).toBe(3))
    expect(lastStored()).toEqual({
      hidden: ['core-host-analytics', 'paid-card', 'free-card'],
      order: [],
    })
  })

  it('turns a hidden card back on without losing the others', async () => {
    mockStoredWidgetsField = {
      [ORG_ID]: { hidden: ['paid-card', 'free-card'], order: [] },
    }
    await openDialog()
    fireEvent.click(await screen.findByLabelText('show Paid card'))
    await waitFor(() => expect(mockWrites.length).toBe(1))
    expect(lastStored()).toEqual({ hidden: ['free-card'], order: [] })
  })

  it('stores a rank naming the whole slot group when a card is moved', async () => {
    await openDialog()
    fireEvent.click(await screen.findByLabelText('move Paid card down'))
    await waitFor(() => expect(mockWrites.length).toBe(1))
    expect(lastStored()).toEqual({
      hidden: [],
      order: ['free-card', 'paid-card'],
    })
  })

  it('cannot move the first card up, or the last card down', async () => {
    await openDialog()
    expect(
      (await screen.findByLabelText('move Paid card up')).hasAttribute(
        'disabled',
      ),
    ).toBe(true)
    expect(
      screen.getByLabelText('move Free plugin down').hasAttribute('disabled'),
    ).toBe(true)
    // THE CONTROL: the arrows are not disabled everywhere, which would pass
    // the two assertions above while making the feature inert.
    expect(
      screen.getByLabelText('move Paid card down').hasAttribute('disabled'),
    ).toBe(false)
  })

  it('gives the console’s own card no neighbors to trade with', async () => {
    // `Traffic` spans the container above the capability grid; there is
    // nothing beside it for an arrow to swap it with.
    await openDialog()
    expect(
      (await screen.findByLabelText('move Traffic up')).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByLabelText('move Traffic down').hasAttribute('disabled'),
    ).toBe(true)
  })
})
