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
 * The widget zones AGL-2940 added — billing, staff, member, collaborator,
 * assistant dock, besigner inspector — exist twice: as a key in the catalog
 * and as a `PluginWidgetSlot` mounted on a page. This spec ties the two
 * together, both ways:
 *
 * 1. every catalog key is mounted somewhere under `apps/console` (a key with
 *    no mount is a zone a plugin can register for and never appear in);
 * 2. every new key, when a plugin registers a widget for it, renders that
 *    widget with the props the zone documents — through the REAL slot, so
 *    the enablement, entitlement and permission gates are the ones a page
 *    would apply.
 *
 * The source read is the mount inventory; the render is the proof the shell
 * draws what was registered. Two column zones are mounted through the column
 * helper rather than the slot, and the inventory says so by name.
 */

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

/** The slot the registry is asked for, and what it answers. */
let mockSlot: string
let lastWidgetProps: Record<string, unknown> | undefined
/** The SEO zones' proposal doors (AGL-2910), passed through by identity. */
const mockProposeValues = jest.fn()
const mockProposeDraft = jest.fn()
/**
 * Registrations the registry answers for `mockSlot` beside the demo card: a
 * table column widget on a zone that also mounts cards (AGL-3008).
 */
let mockExtraRegistrations: Array<Record<string, unknown>> = []

function MockWidget(props: Record<string, unknown>) {
  lastWidgetProps = props
  return <div>{`widget-for-${mockSlot}`}</div>
}

function MockColumnCell() {
  return <div>{`column-cell-for-${mockSlot}`}</div>
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  listConsoleWidgets: (slot: string) =>
    slot === mockSlot
      ? [
          {
            extension: { pluginId: 'demo', displayName: 'Demo' },
            widget: { slot, widgetId: `demo-${slot}`, Component: MockWidget },
          },
          ...mockExtraRegistrations,
        ]
      : [],
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
  useCurrentOrg: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
}))

import PluginWidgetSlot from '../components/plugin-widget-slot.component'

/**
 * Where each new zone is mounted, and how. A `slot` entry is a
 * `<PluginWidgetSlot slot="…">`; a `columns` entry is the column helper
 * reading the zone for table columns.
 */
const MOUNTS: Record<
  string,
  { file: string; how: 'slot' | 'columns' | 'both'; props: Record<string, unknown> }
> = {
  orgBillingUsage: {
    file: 'apps/console/app/(app)/[orgSlug]/billing/(sections)/usage/page.tsx',
    how: 'slot',
    props: { orgId: 'org-1', org: {}, canManage: true },
  },
  orgBillingOverview: {
    file: 'apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx',
    how: 'slot',
    props: { orgId: 'org-1', org: {}, plan: 'pro', canManage: true },
  },
  staffOrg: {
    file: 'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx',
    how: 'slot',
    props: { orgId: 'org-1' },
  },
  staffUser: {
    file: 'apps/console/app/(app)/admin/users/[uid]/page.tsx',
    how: 'slot',
    props: { uid: 'u2' },
  },
  orgMember: {
    file: 'apps/console/app/(app)/[orgSlug]/team/[uid]/page.tsx',
    how: 'slot',
    props: { orgId: 'org-1', uid: 'u2', member: { $id: 'u2' }, canManage: true },
  },
  orgMembersListColumn: {
    file: 'apps/console/components/org-members-card.component.tsx',
    how: 'columns',
    props: {},
  },
  hostMembers: {
    file: 'apps/console/components/host-members-card.component.tsx',
    how: 'both',
    props: { hostId: 'host-1', canManage: true },
  },
  assistPanel: {
    file: 'apps/console/components/assist-dock-slot.component.tsx',
    how: 'slot',
    props: {},
  },
  besignerInspector: {
    file:
      'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx',
    how: 'slot',
    props: { hostId: 'host-1' },
  },
  // AGL-2910: the screen detail page's SEO card, and the site SEO section.
  seoFields: {
    file:
      'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
    how: 'slot',
    props: {
      hostId: 'host-1',
      orgId: 'org-1',
      orgSlug: 'acme',
      subject: { kind: 'screen', id: 'screen-1', versionId: 'v1', name: 'Pricing' },
      fields: ['title', 'description', 'breadcrumb', 'imageAlt'],
      values: { title: 'Pricing' },
      hasImage: false,
      proposeValues: mockProposeValues,
    },
  },
  hostSeo: {
    file: 'apps/console/app/(app)/[orgSlug]/hosts/[host]/setup/(sections)/seo/page.tsx',
    how: 'slot',
    props: {
      hostId: 'host-1',
      orgId: 'org-1',
      orgSlug: 'acme',
      host: 'shop',
      seo: { title: 'Acme Widgets' },
      proposeDraft: mockProposeDraft,
    },
  },
  besignerToolbar: {
    file: 'apps/console/components/besigner-plugin-zones.component.tsx',
    how: 'slot',
    props: { hostId: 'host-1' },
  },
  staffOrgsListColumn: {
    file: 'apps/console/app/(app)/admin/orgs/page.tsx',
    how: 'columns',
    props: {},
  },
  staffOrgUsageColumn: {
    file: 'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx',
    how: 'both',
    props: { orgId: 'org-1', org: {} },
  },
}

const NEW_ZONES = Object.keys(MOUNTS)

/**
 * Every zone mounted anywhere in the console: a literal `slot="…"`, a
 * `slot={CONSOLE_WIDGET_SLOTS.…}`, or the column helper reading a zone.
 */
function mountedZones(): Set<string> {
  const out = execFileSync(
    'git',
    [
      'grep',
      '--untracked',
      '-h',
      '-o',
      '-E',
      String.raw`(slot="[A-Za-z]+"|slot=\{CONSOLE_WIDGET_SLOTS\.[A-Za-z]+\}|usePluginListColumns\('[A-Za-z]+'\))`,
      '--',
      'apps/console',
      ':!apps/console/specs',
      ':!*.spec.*',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return new Set(
    out
      .split('\n')
      .map(
        (line) =>
          line.match(/["']([A-Za-z]+)["']/)?.[1] ??
          line.match(/CONSOLE_WIDGET_SLOTS\.([A-Za-z]+)/)?.[1],
      )
      .filter((zone): zone is string => Boolean(zone)),
  )
}

const read = (file: string) => readFileSync(resolve(REPO_ROOT, file), 'utf8')

describe('AGL-2940 · the new zones are in the catalog and mounted', () => {
  it('names every new zone in CONSOLE_WIDGET_SLOTS', () => {
    for (const zone of NEW_ZONES) {
      expect((CONSOLE_WIDGET_SLOTS as Record<string, string>)[zone]).toBe(zone)
    }
  })

  it('mounts every catalog zone somewhere under apps/console', () => {
    const mounted = mountedZones()
    // ANTI-VACUITY: the grep found the zones that predate this issue.
    expect(mounted.has('hostDashboard')).toBe(true)
    const unmounted = Object.values(CONSOLE_WIDGET_SLOTS).filter(
      (zone) => !mounted.has(zone),
    )
    expect(unmounted).toEqual([])
  })

  it('mounts each new zone in the file the inventory names, the way it says', () => {
    for (const [zone, mount] of Object.entries(MOUNTS)) {
      const source = read(mount.file)
      const slotMount = source.includes(`slot="${zone}"`)
      const columnMount = source.includes(`usePluginListColumns('${zone}')`)
      if (mount.how === 'slot') expect(`${zone}: ${slotMount}`).toBe(`${zone}: true`)
      if (mount.how === 'columns') expect(`${zone}: ${columnMount}`).toBe(`${zone}: true`)
      if (mount.how === 'both') {
        expect(`${zone}: ${slotMount && columnMount}`).toBe(`${zone}: true`)
      }
    }
  })

  it('both shells mount the assistant dock above every route boundary', () => {
    expect(read('apps/console/app/(app)/layout.tsx')).toContain('<AssistDockSlot />')
    expect(read('apps/console/app/(editor)/layout.tsx')).toContain('<AssistDockSlot />')
  })
})

describe('AGL-2940 · a registered widget renders through each new zone', () => {
  beforeEach(() => {
    lastWidgetProps = undefined
  })

  for (const zone of NEW_ZONES.filter((key) => MOUNTS[key].how !== 'columns')) {
    it(`${zone}: renders the plugin's widget with the zone's props`, async () => {
      mockSlot = zone
      render(<PluginWidgetSlot slot={zone} {...MOUNTS[zone].props} />)
      await waitFor(() => expect(screen.getByText(`widget-for-${zone}`)).toBeTruthy())
      expect(lastWidgetProps).toEqual(expect.objectContaining(MOUNTS[zone].props))
    })
  }

  it('a zone nobody registered for renders nothing', () => {
    mockSlot = 'somewhereElse'
    const { container } = render(<PluginWidgetSlot slot="staffOrg" orgId="org-1" />)
    expect(container.textContent).toBe('')
  })
})

describe('AGL-3008 · a column widget belongs to its table, never to the slot', () => {
  afterEach(() => {
    mockExtraRegistrations = []
  })

  it('hostMembers: draws the card, and leaves the column widget to the collaborators table', async () => {
    mockSlot = 'hostMembers'
    mockExtraRegistrations = [
      {
        extension: { pluginId: 'demo', displayName: 'Demo' },
        widget: {
          slot: 'hostMembers',
          widgetId: 'demo-hostMembers-column',
          column: { header: 'AI' },
          Component: MockColumnCell,
        },
      },
    ]
    render(<PluginWidgetSlot slot="hostMembers" {...MOUNTS.hostMembers.props} />)
    await waitFor(() => expect(screen.getByText('widget-for-hostMembers')).toBeTruthy())
    // The column's cell belongs to a row of the collaborators table. Drawn by
    // the slot it would be a cell with no row, loose beneath the table.
    expect(screen.queryByText('column-cell-for-hostMembers')).toBeNull()
  })
})
