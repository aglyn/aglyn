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
 * A plugin's staff pages render in the staff area (AGL-2939).
 *
 * `ConsoleExtension.staffPages` is the seam: a plugin names a page, and the
 * console gives it a tab in the staff strip and a URL at `/admin/{id}`,
 * rendered by the generic staff route inside the staff chrome. Two unrelated
 * plugins register one each, through the real registry; a third plugin that
 * the staff area does not load registers one too, and it must not answer.
 *
 * The strip is proven through `useSecondaryNav` itself, because the bar is
 * drawn above the staff layout that loads the plugins: the plugin tabs have
 * to appear when that load settles, not on the next navigation.
 */

import {
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsoleStaffPageProps,
} from '@aglyn/aglyn'
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockStaffPage = ''
let mockPathname = '/admin/overview'

jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ staffPage: mockStaffPage }),
  usePathname: () => mockPathname,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    breadcrumbItems,
    header,
    help,
    children,
  }: {
    breadcrumbItems: Array<{ children: ReactNode; href?: string }>
    header: { children: ReactNode }
    help: string
    children: ReactNode
  }) => (
    <div>
      <nav>
        {breadcrumbItems.map((item, index) => (
          <a key={index} href={item.href}>
            {item.children}
          </a>
        ))}
      </nav>
      <h1 data-help={help}>{header.children}</h1>
      {children}
    </div>
  ),
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}))

jest.mock('../constants/staff-plugins', () => ({
  __esModule: true,
  ...jest.requireActual('../constants/staff-plugins'),
  STAFF_PLUGIN_IDS: ['ai', 'acme-backups'],
}))

// The secondary nav's other inputs, as a staff reader on a staff route has
// them. Held objects: the hook keys memos on these.
const ORG_SCOPE = { orgs: [], loading: false }
const ORG_REACH = { orgWide: true, ready: true }
const ORG_TABS: never[] = []
const NO_PLUGINS: string[] = []
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgScope: () => ORG_SCOPE,
  default: () => ORG_SCOPE,
}))
jest.mock('../hooks/use-org-reach', () => ({
  __esModule: true,
  useOrgReach: () => ORG_REACH,
}))
jest.mock('../hooks/use-org-nav-tabs', () => ({
  __esModule: true,
  default: () => ORG_TABS,
}))
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  default: () => true,
  useIsStaff: () => true,
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => undefined,
  useHostReady: () => true,
  useIsHostAdmin: () => false,
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => NO_PLUGINS,
}))

import AdminStaffPluginPage from '../app/(app)/admin/[staffPage]/page'
import adminNavTabItems from '../constants/admin-nav-tabs'
import {
  markStaffPluginsSettled,
  resetStaffPluginsSettledForTests,
} from '../constants/staff-plugins'
import { useSecondaryNav } from '../hooks/use-secondary-nav'

function SignalsPage({ basePath }: ConsoleStaffPageProps) {
  return <p>{`signals body at ${basePath}`}</p>
}
function BackupsPage({ basePath }: ConsoleStaffPageProps) {
  return <p>{`backups body at ${basePath}`}</p>
}
function CrmPage() {
  return <p>crm staff body</p>
}

beforeEach(() => {
  registerConsoleExtension({
    pluginId: 'ai',
    displayName: 'AI',
    staffPages: [
      {
        id: 'model-quality',
        label: 'Model quality',
        header: { title: 'Model Quality', docsTopic: 'assistSignals' },
        Component: SignalsPage,
      },
    ],
  })
  registerConsoleExtension({
    pluginId: 'acme-backups',
    displayName: 'Backups',
    staffPages: [{ id: 'backups', label: 'Backups', Component: BackupsPage }],
  })
  // Loaded this session by an org route, and not a staff plugin.
  registerConsoleExtension({
    pluginId: 'crm',
    displayName: 'CRM',
    staffPages: [{ id: 'crm-staff', label: 'CRM', Component: CrmPage }],
  })
})

afterEach(() => {
  for (const pluginId of ['ai', 'acme-backups', 'crm']) unregisterConsoleExtension(pluginId)
})

describe('the generic staff route', () => {
  it('renders a staff plugin\'s page in the staff chrome, at its own path', () => {
    mockStaffPage = 'model-quality'
    render(<AdminStaffPluginPage />)
    expect(screen.getByText('signals body at /admin/model-quality')).toBeTruthy()
    const heading = screen.getByRole('heading')
    expect(heading.textContent).toBe('Model Quality')
    expect(heading.getAttribute('data-help')).toBe('assistSignals')
    expect(
      screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Staff', '/admin/overview'],
      ['Model quality', '/admin/model-quality'],
    ])
  })

  it('a second plugin\'s page renders at its id, titled by its label and helped by the staff docs', () => {
    mockStaffPage = 'backups'
    render(<AdminStaffPluginPage />)
    expect(screen.getByText('backups body at /admin/backups')).toBeTruthy()
    const heading = screen.getByRole('heading')
    expect(heading.textContent).toBe('Backups')
    expect(heading.getAttribute('data-help')).toBe('staffConsole')
  })

  it('is the ordinary 404 for an id no staff plugin registered', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockStaffPage = 'nope'
    expect(() => render(<AdminStaffPluginPage />)).toThrow('NEXT_NOT_FOUND')
    // Registered, but by a plugin the staff area does not load.
    mockStaffPage = 'crm-staff'
    expect(() => render(<AdminStaffPluginPage />)).toThrow('NEXT_NOT_FOUND')
    jest.restoreAllMocks()
  })
})

describe('the staff strip', () => {
  beforeEach(() => {
    resetStaffPluginsSettledForTests()
    mockPathname = '/admin/overview'
  })

  it('lists the plugins\' staff pages after the console\'s own tabs', () => {
    const own = adminNavTabItems()
    const tabs = adminNavTabItems([
      { id: 'model-quality', label: 'Model quality' },
      { id: 'backups', label: 'Backups' },
    ])
    expect(tabs.slice(0, own.length)).toEqual(own)
    expect(tabs.slice(own.length)).toEqual([
      {
        id: 'nav-tab-admin-model-quality',
        label: 'Model quality',
        href: '/admin/model-quality',
      },
      { id: 'nav-tab-admin-backups', label: 'Backups', href: '/admin/backups' },
    ])
  })

  it('gives no tab to a staff page whose id is a console staff route, and says so', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const own = adminNavTabItems()
    // `/admin/orgs` is the console's own page: a tab here would open it under
    // the plugin's label.
    expect(adminNavTabItems([{ id: 'orgs', label: 'Backups of orgs' }])).toEqual(own)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"orgs" is a console staff route'))
    error.mockRestore()
  })

  it('draws the plugin tabs when the staff load settles, not on the next navigation', () => {
    const { result } = renderHook(() => useSecondaryNav())
    const own = adminNavTabItems()
    const ids = () => result.current.navTabItems.map((tab) => tab.id)
    expect(result.current.section.kind).toBe('admin')
    expect(ids()).toEqual(own.map((tab) => tab.id))

    act(() => markStaffPluginsSettled())

    expect(ids()).toEqual([
      ...own.map((tab) => tab.id),
      'nav-tab-admin-model-quality',
      'nav-tab-admin-backups',
    ])
    // Not the plugin the staff area does not load.
    expect(result.current.navTabItems.some((tab) => tab.id === 'nav-tab-admin-crm-staff')).toBe(
      false,
    )
  })
})
