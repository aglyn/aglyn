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
 * The staff zones render on the staff pages (AGL-2939).
 *
 * A widget zone lists the plugins the URL's workspace enabled, and a staff
 * URL names no workspace: `useEnabledPluginIds` answers `[]` there, and the
 * console plugins gate loads nothing. A card registered for `staffOrg` or
 * `staffUser` was therefore absent from the one page it was written for,
 * while the zone spec — which answers `['demo']` for every route — stayed
 * green.
 *
 * So this file holds the staff route's real answer (`[]`), an unsettled
 * ambient org and a pending permission read, and proves three things:
 *
 * 1. a staff zone renders the widgets of the plugins the staff area loads,
 *    from two unrelated plugins, and of no other plugin;
 * 2. a workspace zone on the same route still renders nothing;
 * 3. the staff area's layout holds its pages until those plugins have
 *    loaded, and a failed load still renders the pages;
 *
 * and, reading the repository, that every plugin with a staff-zone widget
 * names the `staff` surface the staff area loads it through.
 */

import {
  isConsoleStaffWidgetSlot,
  registerConsoleExtension,
  unregisterConsoleExtension,
} from '@aglyn/aglyn'
import { act, render, screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

const REPO_ROOT = resolve(__dirname, '../../..')

/** Held objects: hooks that key effects on these must see one identity. */
const FIRESTORE = {}
const USER = { uid: 'staff-1' }
const AMBIENT_ORG = { $id: 'org-mine', plan: 'free' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: USER }),
}))

// The ambient org is the reader's own, still loading: nothing a staff zone
// renders may wait on it or be decided by it.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: AMBIENT_ORG, orgId: 'org-mine', ready: false }),
  useCurrentOrg: () => ({ org: AMBIENT_ORG, orgId: 'org-mine', ready: false }),
}))

// A permission read that has not landed, and would refuse when it did.
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => false, loaded: false }),
}))

// The staff route's real answer: the URL names no workspace.
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => [],
  // No workspace to load plugins for (AGL-3142): this file's registry is a
  // double, so a zone or a route here draws from it rather than fetching a
  // plugin's code, and the loading hooks are settled at once.
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))

jest.mock('../constants/staff-plugins', () => ({
  __esModule: true,
  ...jest.requireActual('../constants/staff-plugins'),
  STAFF_PLUGIN_IDS: ['ai', 'acme-backups'],
}))

const mockEnsure = jest.fn()
jest.mock('../constants/console-plugin-loader', () => ({
  __esModule: true,
  consolePluginLoader: {
    ensure: (ids: readonly string[], surfaces: readonly string[]) => mockEnsure(ids, surfaces),
  },
}))

import PluginWidgetSlot, { useSlotWidgets } from '../components/plugin-widget-slot.component'
import StaffPluginsGate, {
  resetStaffPluginsGateForTests,
} from '../components/staff-plugins-gate.component'

function Card({ label, ...props }: { label: string } & Record<string, unknown>) {
  return <div data-testid="card" data-org={String(props['orgId'] ?? '')}>{label}</div>
}
const AiStaffCard = (props: Record<string, unknown>) => <Card label="ai staff card" {...props} />
const AiBillingCard = (props: Record<string, unknown>) => <Card label="ai billing card" {...props} />
const BackupsStaffCard = (props: Record<string, unknown>) => (
  <Card label="backups staff card" {...props} />
)
const CrmStaffCard = (props: Record<string, unknown>) => <Card label="crm staff card" {...props} />

describe('a staff zone on a route that names no workspace', () => {
  beforeEach(() => {
    registerConsoleExtension({
      pluginId: 'ai',
      displayName: 'AI',
      widgets: [
        { slot: 'staffOrg', widgetId: 'ai-org', Component: AiStaffCard },
        { slot: 'orgBillingUsage', widgetId: 'ai-billing', Component: AiBillingCard },
      ],
    })
    // Gated for a workspace in both ways a widget can be: neither applies
    // on a staff page.
    registerConsoleExtension({
      pluginId: 'acme-backups',
      displayName: 'Backups',
      featureFlag: 'commerce',
      widgets: [
        {
          slot: 'staffOrg',
          widgetId: 'backups-org',
          permission: 'backups.view',
          Component: BackupsStaffCard,
        },
      ],
    })
    // Registered this session by an org route, and not a staff plugin.
    registerConsoleExtension({
      pluginId: 'crm',
      displayName: 'CRM',
      widgets: [{ slot: 'staffOrg', widgetId: 'crm-org', Component: CrmStaffCard }],
    })
  })

  afterEach(() => {
    for (const pluginId of ['ai', 'acme-backups', 'crm']) unregisterConsoleExtension(pluginId)
  })

  it('renders every staff plugin\'s widget with the zone\'s props, and no other plugin\'s', () => {
    render(<PluginWidgetSlot slot="staffOrg" orgId="org-under-review" />)
    const cards = screen.getAllByTestId('card')
    expect(cards.map((card) => card.textContent)).toEqual([
      'ai staff card',
      'backups staff card',
    ])
    expect(cards.map((card) => card.getAttribute('data-org'))).toEqual([
      'org-under-review',
      'org-under-review',
    ])
  })

  it('CONTROL: a workspace zone on the same route renders nothing', () => {
    const { container } = render(<PluginWidgetSlot slot="orgBillingUsage" orgId="org-mine" />)
    expect(container.textContent).toBe('')
  })

  it('answers ready without the ambient org or the permission read', () => {
    let seen: ReturnType<typeof useSlotWidgets> | undefined
    function Probe() {
      seen = useSlotWidgets(['staffOrg'])
      return null
    }
    render(<Probe />)
    expect(seen?.ready).toBe(true)
    expect(seen?.widgets.map((widget) => widget.widgetId)).toEqual(['ai-org', 'backups-org'])
  })
})

describe('the staff area loads its plugins before a page renders', () => {
  beforeEach(() => {
    resetStaffPluginsGateForTests()
    mockEnsure.mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it('holds the page until the staff surface has loaded', async () => {
    let finish: () => void = () => undefined
    mockEnsure.mockImplementation(
      () =>
        new Promise<void>((resolvePromise) => {
          finish = resolvePromise
        }),
    )
    render(
      <StaffPluginsGate>
        <p>staff page</p>
      </StaffPluginsGate>,
    )
    expect(screen.queryByText('staff page')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(mockEnsure).toHaveBeenCalledWith(['ai', 'acme-backups'], ['staff'])
    await act(async () => finish())
    await waitFor(() => expect(screen.getByText('staff page')).toBeTruthy())
  })

  it('renders the page when a plugin fails to load, and logs it', async () => {
    mockEnsure.mockRejectedValue(new Error('chunk failed'))
    render(
      <StaffPluginsGate>
        <p>staff page</p>
      </StaffPluginsGate>,
    )
    await waitFor(() => expect(screen.getByText('staff page')).toBeTruthy())
    expect(console.error).toHaveBeenCalledWith(
      'staff plugins failed to load',
      expect.any(Error),
    )
  })

  it('a later mount renders at once, without loading again', async () => {
    mockEnsure.mockResolvedValue(undefined)
    const first = render(
      <StaffPluginsGate>
        <p>first</p>
      </StaffPluginsGate>,
    )
    await waitFor(() => expect(screen.getByText('first')).toBeTruthy())
    first.unmount()
    render(
      <StaffPluginsGate>
        <p>second</p>
      </StaffPluginsGate>,
    )
    expect(screen.getByText('second')).toBeTruthy()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })
})

describe('every plugin with a staff-zone widget names the staff surface', () => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'plugins.config.json'), 'utf8')) as {
    plugins: Array<{ id: string; package: string; register: Record<string, string> }>
  }

  /** Plugin directories whose source registers a widget on a staff zone. */
  function pluginDirsWithStaffWidgets(): string[] {
    const out = execFileSync(
      'git',
      [
        'grep',
        '--untracked',
        '-l',
        '-E',
        String.raw`slot: (CONSOLE_WIDGET_SLOTS\.)?'?(adminOrgDetail|staffOrg|staffUser)'?`,
        '--',
        'libs/plugins',
        ':!*.spec.*',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    return [
      ...new Set(
        out
          .split('\n')
          .map((file) => file.match(/^libs\/plugins\/([^/]+)\/src\//)?.[1])
          .filter((dir): dir is string => Boolean(dir)),
      ),
    ]
  }

  it('in plugins.config.json and in the console manifest the staff area loads', () => {
    const dirs = pluginDirsWithStaffWidgets()
    // ANTI-VACUITY: the AI plugin's staff cards are found.
    expect(dirs).toContain('ai')
    for (const dir of dirs) {
      const plugin = config.plugins.find((entry) => entry.package === `@aglyn/plugins-${dir}`)
      const staff = plugin?.register['staff']
      expect(`${dir}: ${staff ? 'staff surface' : 'no staff surface'}`).toBe(
        `${dir}: staff surface`,
      )
      const manifest = CONSOLE_PLUGIN_MANIFEST.find((entry) => entry.id === plugin?.id)
      expect(manifest?.register['staff']).toBe(staff)
    }
  })

  it('names exactly the staff pages\' zones as staff zones', () => {
    expect(['adminOrgDetail', 'staffOrg', 'staffUser'].every(isConsoleStaffWidgetSlot)).toBe(true)
    expect(isConsoleStaffWidgetSlot('orgBillingUsage')).toBe(false)
  })
})
