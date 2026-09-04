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
 * Plugin widgets are gated on the READER, and the gate costs one read.
 *
 * Two defects, and they are the same defect: `useSlotWidgets` resolved the
 * org's entitlement and never asked who was looking, so a plugin card
 * appeared wherever its slot rendered regardless of what the viewer may do —
 * and the hook that could have answered, `useOrgPermissions`, issued TWO
 * `getDoc`s per call site with no sharing of any kind. Gating N slots the
 * obvious way would have multiplied the member read by N.
 *
 * So this file asserts both halves against the SAME mount, because either one
 * alone is a trap: a gate nobody can afford gets reverted, and a shared read
 * that gates nothing is a refactor pretending to be a fix.
 *
 * ## What is real here, and why that matters
 *
 * `useOrgPermissions`, `resolveOrgPermissions`, `resolveExtensionPermission`
 * and `PluginWidgetSlot` are all the REAL implementations. Only Firestore is
 * a double, and only so the reads can be COUNTED. A stub answering "no" to
 * every permission would make every refusal below pass while proving nothing,
 * which is why every refusal is paired with a control that drives the same
 * code path to a render, and why the reader's verdict is changed by editing
 * the member DOCUMENT rather than by editing a mock's return value.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'

/** Every `getDoc` this render performs, by document path. */
let mockReads: string[]
/** The member document the org has for this reader. */
let mockMemberDoc: Record<string, unknown>
/** `orgs/{org}/roles/{roleId}`, when the member names one. */
let mockRoleDoc: Record<string, unknown> | undefined
/** Widget registrations the slot will see. */
let mockRegistered: Array<{
  extension: Record<string, unknown>
  widget: Record<string, unknown>
}>
/** Mounts recorded per widget id, so "did not render" is a positive claim. */
let mounts: Record<string, number>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getDoc: async (ref: { path: string }) => {
    mockReads.push(ref.path)
    if (ref.path.includes('/roles/')) {
      return {
        exists: () => mockRoleDoc !== undefined,
        data: () => mockRoleDoc,
        get: (key: string) => (mockRoleDoc as never)?.[key],
      }
    }
    return {
      exists: () => true,
      data: () => mockMemberDoc,
      get: (key: string) => (mockMemberDoc as never)?.[key],
    }
  },
}))

/**
 * STABLE IDENTITY. `useFirestore` is in the resolution effect's dependency
 * list; a factory returning a fresh `{}` per call re-runs it forever, which is
 * a microtask loop jest's real-timer timeout never interrupts — the suite
 * hangs instead of failing.
 */
const FIRESTORE = {}

/**
 * And the signed-in user, for the same reason plus a sharper one: `user` is
 * in the effect's dependency list too, so a factory minting a fresh object
 * per render makes the resolution re-read on EVERY render — which would show
 * up here as a read count that silently doubles and has nothing to do with
 * the code under test. The real `useUser` holds the `User` in state and hands
 * back the same instance across renders; this matches that.
 */
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

/**
 * The org read, already settled and entitled. This file is about the
 * PERMISSION gate; `plugin-surface-entitlement-gate.spec.tsx` owns the other
 * one, and leaving the org unsettled here would withhold every widget for a
 * reason that has nothing to do with what is under test.
 */
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
  useCurrentOrg: () => ({
    org: { $id: 'org-1', plan: 'pro' },
    orgId: 'org-1',
    ready: true,
  }),
}))

jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // The REGISTRY is the double — the resolver, the permission catalog and
  // `resolveOrgPermissions` all stay real, because they are the verdict.
  listConsoleWidgets: (slot: string) =>
    mockRegistered.filter((entry) => entry.widget['slot'] === slot),
}))

import { registerPluginPermissions } from '@aglyn/aglyn'
import PluginWidgetSlot, {
  useSlotWidgets,
} from '../components/plugin-widget-slot.component'
import { OrgPermissionsProvider } from '../hooks/use-org-permissions'

/**
 * The plugin key space has to be POPULATED before a key in it can be
 * answered — `resolveRolePermissions` iterates the registered keys, so an
 * unregistered one materializes as `undefined` in the resolved map and is
 * refused no matter what the member document says.
 *
 * Registered here because the pair of `managePos` cases below would otherwise
 * BOTH pass by refusing, which is the exact vacuity this file is written
 * against: a revoked key and a granted key would look identical, and the
 * "revoked" assertion would be proving that a typo is refused.
 */
registerPluginPermissions([
  {
    key: 'managePos',
    pluginId: 'demo',
    label: 'Manage register',
    defaults: { admin: true, editor: false, viewer: false },
  },
])

/** A widget that records its own construction. */
const widgetComponent = (id: string) => () => {
  mounts[id] = (mounts[id] ?? 0) + 1
  return <div>{`widget-${id}`}</div>
}

const registerWidget = (options: {
  id: string
  slot?: string
  widgetPermission?: string
  extensionPermission?: string
}) => {
  mockRegistered.push({
    extension: {
      pluginId: 'demo',
      displayName: 'Demo',
      permission: options.extensionPermission,
    },
    widget: {
      slot: options.slot ?? 'hostDashboard',
      widgetId: options.id,
      permission: options.widgetPermission,
      Component: widgetComponent(options.id),
    },
  })
}

const withProvider = (children: ReactNode) => (
  <OrgPermissionsProvider>{children}</OrgPermissionsProvider>
)

/**
 * Mount the slot, and WAIT FOR THE VERDICT before asserting anything about
 * what it drew.
 *
 * The listing rendered alongside is what makes the wait honest. Waiting on
 * the read COUNT was the first draft and it is a trap: a read has been issued
 * long before its answer has been applied, so every "the widget is absent"
 * assertion was really being made inside the pending window — where every
 * widget is absent, whatever the gate decides. That draft survived a mutant
 * that granted every unrecognized permission key, because the mutant's extra
 * render simply had not happened yet. `ready:true` is the slot's own
 * statement that both gates have settled.
 */
const mountSlotAndSettle = async () => {
  render(
    withProvider(
      <>
        <PluginWidgetSlot slot="hostDashboard" />
        <CustomizeListing />
      </>,
    ),
  )
  await waitFor(() => expect(screen.getByText('ready:true')).toBeTruthy())
}

/** The dashboard's shape: four slots on one page. */
const FOUR_SLOTS = (
  <>
    <PluginWidgetSlot slot="hostDashboard" />
    <PluginWidgetSlot slot="commerceGlance" />
    <PluginWidgetSlot slot="hostActivity" />
    <PluginWidgetSlot slot="dashboardFooter" />
  </>
)

/** The fifth consumer on that page — the customize dialog's listing. */
function CustomizeListing() {
  const { widgets, ready } = useSlotWidgets(['hostDashboard'])
  return (
    <div>
      <span>{`listed:${widgets.length}`}</span>
      <span>{`ready:${ready}`}</span>
    </div>
  )
}

beforeEach(() => {
  mockReads = []
  mockMemberDoc = { role: 'editor' }
  mockRoleDoc = undefined
  mockRegistered = []
  mounts = {}
})

// ── The gate ────────────────────────────────────────────────────────────────

describe('a plugin widget behind a permission', () => {
  it('does not render for a reader whose custom role revokes it', async () => {
    mockMemberDoc = { role: 'editor', roleId: 'custom-1' }
    mockRoleDoc = { permissions: { 'data.manage': false } }
    registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(screen.queryByText('widget-w1')).toBeNull()
    // Never CONSTRUCTED — a component that mounted and then hid itself would
    // still have run its effects and opened its listeners.
    expect(mounts['w1']).toBeUndefined()
  })

  it('CONTROL: renders the same widget for a reader who holds it', async () => {
    // Same widget, same slot, same mount — only the member document differs.
    // `editor` carries `data.manage` by default.
    mockMemberDoc = { role: 'editor' }
    registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

    await mountSlotAndSettle()

    expect(screen.getByText('widget-w1')).toBeTruthy()
    expect(screen.getByText('listed:1')).toBeTruthy()
    expect(mounts['w1']).toBe(1)
  })

  it('CONTROL: a viewer is refused the permission an editor holds', async () => {
    mockMemberDoc = { role: 'viewer' }
    registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(mounts['w1']).toBeUndefined()
  })

  it('CONTROL: a widget declaring nothing renders for that same viewer', async () => {
    // The anti-vacuity control for the case above. If the gate refused
    // everything — a stub answering "no", a `permissions` map read from the
    // wrong key space — the viewer test would pass and this would fail.
    mockMemberDoc = { role: 'viewer' }
    registerWidget({ id: 'open' })

    await mountSlotAndSettle()

    expect(screen.getByText('widget-open')).toBeTruthy()
    expect(screen.getByText('listed:1')).toBeTruthy()
  })

  it('refuses a widget whose extension is gated, even when the widget is not', async () => {
    mockMemberDoc = { role: 'editor' }
    registerWidget({ id: 'w1', extensionPermission: 'billing.manage' })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(mounts['w1']).toBeUndefined()
  })

  it('refuses a widget whose OWN key is held but whose extension is not', async () => {
    // Composition by AND. A widget must not escape its extension's gate by
    // naming a key its reader happens to hold.
    mockMemberDoc = { role: 'editor' }
    registerWidget({
      id: 'w1',
      extensionPermission: 'billing.manage',
      widgetPermission: 'data.manage',
    })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(mounts['w1']).toBeUndefined()
  })

  it('CONTROL: both keys held renders it', async () => {
    mockMemberDoc = { role: 'admin' }
    registerWidget({
      id: 'w1',
      extensionPermission: 'billing.manage',
      widgetPermission: 'data.manage',
    })

    await mountSlotAndSettle()

    expect(screen.getByText('widget-w1')).toBeTruthy()
    expect(screen.getByText('listed:1')).toBeTruthy()
  })

  it('refuses a key in no permission vocabulary at all', async () => {
    // A typo, or a plugin whose `registerPluginPermissions` never ran. Both
    // are surfaces nobody decided may be opened, and answering "granted"
    // would make a misspelled gate indistinguishable from no gate.
    mockMemberDoc = { role: 'owner' }
    registerWidget({ id: 'w1', widgetPermission: 'data.manag' })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(mounts['w1']).toBeUndefined()
  })

  it('CONTROL: the correctly spelled key renders for that same owner', async () => {
    mockMemberDoc = { role: 'owner' }
    registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

    await mountSlotAndSettle()

    expect(screen.getByText('widget-w1')).toBeTruthy()
    expect(screen.getByText('listed:1')).toBeTruthy()
  })

  it('honors a PLUGIN-declared key from the per-member override map', async () => {
    // The other key space. `managePos` is not in the dotted catalog; it is
    // answered from the resolved map that carries plugin keys, and reading it
    // out of the dotted one would silently answer "absent".
    mockMemberDoc = { role: 'admin', permissions: { managePos: false } }
    registerWidget({ id: 'pos', widgetPermission: 'managePos' })

    await mountSlotAndSettle()

    expect(screen.getByText('listed:0')).toBeTruthy()
    expect(mounts['pos']).toBeUndefined()
  })

  it('CONTROL: the same plugin key renders when it is not revoked', async () => {
    mockMemberDoc = { role: 'admin', permissions: { managePos: true } }
    registerWidget({ id: 'pos', widgetPermission: 'managePos' })

    await mountSlotAndSettle()

    expect(screen.getByText('widget-pos')).toBeTruthy()
    expect(screen.getByText('listed:1')).toBeTruthy()
  })

  it('withholds a gated widget for the whole pending window', async () => {
    // `useOrgPermissions` answers the permissive ADMIN map while the member
    // document is in flight, so "not yet known" and "granted" are one value
    // in it. A widget rendered from that is the leak the gate exists to close.
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const firestore = jest.requireMock('firebase/firestore')
    const realGetDoc = firestore.getDoc
    firestore.getDoc = async (ref: { path: string }) => {
      await gate
      return realGetDoc(ref)
    }
    try {
      mockMemberDoc = { role: 'owner' }
      registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

      render(withProvider(<PluginWidgetSlot slot="hostDashboard" />))

      // Nothing yet, though the loading map would say "owner".
      expect(mounts['w1']).toBeUndefined()
      release(undefined)
      // And it arrives once the document does — the control that stops this
      // passing against a gate that withholds forever.
      await waitFor(() => expect(screen.getByText('widget-w1')).toBeTruthy())
    } finally {
      firestore.getDoc = realGetDoc
    }
  })

  it('is not READY while a gated widget is still pending', async () => {
    /*
     * The customize dialog lists what the slot WOULD render, so answering
     * ready inside the pending window tells it the list is final and then
     * grows it — a switch appearing under the reader's cursor.
     */
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const firestore = jest.requireMock('firebase/firestore')
    const realGetDoc = firestore.getDoc
    firestore.getDoc = async (ref: { path: string }) => {
      await gate
      return realGetDoc(ref)
    }
    try {
      mockMemberDoc = { role: 'owner' }
      registerWidget({ id: 'w1', widgetPermission: 'data.manage' })

      render(withProvider(<CustomizeListing />))

      expect(screen.getByText('ready:false')).toBeTruthy()
      release(undefined)
      await waitFor(() => expect(screen.getByText('ready:true')).toBeTruthy())
      expect(screen.getByText('listed:1')).toBeTruthy()
    } finally {
      firestore.getDoc = realGetDoc
    }
  })

  it('CONTROL: is READY immediately when no widget declares a permission', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const firestore = jest.requireMock('firebase/firestore')
    const realGetDoc = firestore.getDoc
    firestore.getDoc = async (ref: { path: string }) => {
      await gate
      return realGetDoc(ref)
    }
    try {
      registerWidget({ id: 'open' })
      render(withProvider(<CustomizeListing />))
      expect(screen.getByText('ready:true')).toBeTruthy()
      expect(screen.getByText('listed:1')).toBeTruthy()
    } finally {
      release(undefined)
      firestore.getDoc = realGetDoc
    }
  })

  it('CONTROL: an UNGATED widget is not held behind the member read', async () => {
    // A surface that declares nothing must not wait on a document it does not
    // need — that would put a spinner in front of an answer never in doubt,
    // on the overwhelming majority of console cards.
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const firestore = jest.requireMock('firebase/firestore')
    const realGetDoc = firestore.getDoc
    firestore.getDoc = async (ref: { path: string }) => {
      await gate
      return realGetDoc(ref)
    }
    try {
      registerWidget({ id: 'open' })
      render(withProvider(<PluginWidgetSlot slot="hostDashboard" />))
      await waitFor(() => expect(screen.getByText('widget-open')).toBeTruthy())
    } finally {
      release(undefined)
      firestore.getDoc = realGetDoc
    }
  })
})

// ── The cost ────────────────────────────────────────────────────────────────

describe('the shared resolution', () => {
  it('issues ONE member read for a page of five consumers', async () => {
    // The host dashboard's real shape: four widget slots plus the customize
    // dialog's listing. Before the provider each of those five called
    // `useOrgPermissions`, and each call was its own `getDoc`.
    mockMemberDoc = { role: 'editor' }
    for (const slot of [
      'hostDashboard',
      'commerceGlance',
      'hostActivity',
      'dashboardFooter',
    ]) {
      registerWidget({ id: `w-${slot}`, slot, widgetPermission: 'data.manage' })
    }

    render(
      withProvider(
        <>
          {FOUR_SLOTS}
          <CustomizeListing />
        </>,
      ),
    )

    await waitFor(() => expect(screen.getByText('ready:true')).toBeTruthy())
    expect(screen.getByText('listed:1')).toBeTruthy()
    // ONE document, read ONCE. Not "fewer than before" — exactly one.
    expect(mockReads).toEqual(['orgs/org-1/members/u1'])
    // And the gate really did run on all five, so this is not one read
    // because four consumers quietly resolved to nothing.
    expect(Object.keys(mounts).sort()).toEqual([
      'w-commerceGlance',
      'w-dashboardFooter',
      'w-hostActivity',
      'w-hostDashboard',
    ])
  })

  it('reads the custom role at most once for that same page', async () => {
    mockMemberDoc = { role: 'editor', roleId: 'custom-1' }
    mockRoleDoc = { permissions: { 'data.manage': true } }
    for (const slot of [
      'hostDashboard',
      'commerceGlance',
      'hostActivity',
      'dashboardFooter',
    ]) {
      registerWidget({ id: `w-${slot}`, slot, widgetPermission: 'data.manage' })
    }

    render(
      withProvider(
        <>
          {FOUR_SLOTS}
          <CustomizeListing />
        </>,
      ),
    )

    await waitFor(() => expect(screen.getByText('ready:true')).toBeTruthy())
    expect(screen.getByText('listed:1')).toBeTruthy()
    expect(mockReads).toEqual([
      'orgs/org-1/members/u1',
      'orgs/org-1/roles/custom-1',
    ])
  })

  it('MEASUREMENT: the same five consumers cost 5x that with no provider', async () => {
    // The before number, measured rather than remembered — and the control
    // that stops the assertion above passing because the hook stopped reading
    // at all. Off the provider every consumer resolves for itself, which is
    // exactly what this change is worth.
    mockMemberDoc = { role: 'editor', roleId: 'custom-1' }
    mockRoleDoc = { permissions: { 'data.manage': true } }
    for (const slot of [
      'hostDashboard',
      'commerceGlance',
      'hostActivity',
      'dashboardFooter',
    ]) {
      registerWidget({ id: `w-${slot}`, slot, widgetPermission: 'data.manage' })
    }

    render(
      <>
        {FOUR_SLOTS}
        <CustomizeListing />
      </>,
    )

    await waitFor(() => expect(screen.getByText('ready:true')).toBeTruthy())
    expect(screen.getByText('listed:1')).toBeTruthy()
    expect(mockReads.length).toBe(10)
    expect(mockReads.filter((path) => path.endsWith('members/u1')).length).toBe(5)
    expect(mockReads.filter((path) => path.includes('/roles/')).length).toBe(5)
  })

  it('the provider is MOUNTED above the console, not merely exported', async () => {
    /*
     * The saving above is real only where the provider actually is. This is a
     * source assertion for the same reason `dashboard-cards-are-mockRegistered`
     * is one: a provider that exists and is mounted nowhere leaves every
     * consumer on the fallback path, and no behavioral test in this file
     * would notice — they all mount it themselves.
     */
    const layout = readFileSync(
      join(__dirname, '../components/layouts/firebase-app.layout.tsx'),
      'utf8',
    )
    expect(layout).toContain('<OrgPermissionsProvider>')
    // Inside the org scope: mounted above it the provider mockReads the scope
    // context DEFAULT — no org, forever — which is the AGL-1935 shape.
    const scopeAt = layout.indexOf('<OrgScopeProvider>')
    const permsAt = layout.indexOf('<OrgPermissionsProvider>')
    expect(scopeAt).toBeGreaterThan(-1)
    expect(permsAt).toBeGreaterThan(scopeAt)
  })
})
