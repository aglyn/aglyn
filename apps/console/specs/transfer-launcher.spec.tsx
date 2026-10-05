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
 * A plugin opens the import wizard and the export dialog through the core
 * launcher (AGL-3539).
 *
 * The plugin side is `useTransferLauncher()` from `@aglyn/aglyn` and nothing
 * else; the console shell answers it with the UI kit. Asserted at both hops:
 * the provider opens the surface for the workspace the URL names (and
 * nothing off a workspace), and the surface renders the kit component the
 * launch asked for, with the resource, site, selection and filter it named.
 * The launcher's `can` (AGL-3546) answers by the transfer gate's own rule,
 * so a plugin offers Import only to a member who may import and Export to
 * any member who may read — and only on a plan that carries the resource's
 * `featureFlag` (AGL-3555: the CRM's on Free, but its people files' export).
 */

import { useTransferLauncher, type TransferAccessTarget, type TransferLauncher } from '@aglyn/aglyn'
import { act, fireEvent, render, screen } from '@testing-library/react'

const mockKit: Array<{ component: string; props: Record<string, unknown> }> = []

jest.mock('@aglyn/aglyn-transfer-ui', () => {
  const react = jest.requireActual('react')
  const stub = (component: string) => (props: Record<string, unknown>) => {
    mockKit.push({ component, props })
    return react.createElement('div', { 'data-testid': component, 'data-resource': props['resource'] })
  }
  return {
    __esModule: true,
    TransferImportWizard: stub('import-wizard'),
    TransferExportDialog: stub('export-dialog'),
  }
})

// The provider loads the surface lazily; here it is the surface itself.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => jest.requireActual('../components/transfer-launcher-surface.component').default,
}))

let mockOrg: { $id: string; role?: string; orgWide?: boolean } | null = { $id: 'org-1' }
const mockFirestore = {}
let mockGranted = new Set<string>(['data.manage'])
let mockPermissionsLoaded = true
let mockMemberDoc: Record<string, unknown> | null = null

jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    loaded: mockPermissionsLoaded,
    orgId: 'org-1',
    granted: Object.fromEntries([...mockGranted].map((key) => [key, true])),
    permissions: {},
    can: (permission: string) => mockGranted.has(permission),
  }),
}))

/** The workspace document the shell judges the plan from. */
let mockBilling: { org: Record<string, unknown> | undefined; ready: boolean } = { org: { plan: 'starter' }, ready: true }

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockBilling.org, orgId: 'org-1', ready: mockBilling.ready, entitlementsFromCache: false }),
}))

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: async () => ({ data: () => mockMemberDoc }),
}))
jest.mock('../hooks/use-url-names-org', () => ({
  __esModule: true,
  useUrlNamedOrg: () => mockOrg,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token-1' } }),
  useFirestore: () => mockFirestore,
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => {
  const react = jest.requireActual('react')
  const Consent = (props: { setValue(value: unknown): void; setComplete(done: boolean): void; jobId: string | null }) =>
    react.createElement(
      'button',
      {
        onClick: () => {
          props.setValue({ agreed: true })
          props.setComplete(true)
        },
      },
      `Agree for ${props.jobId}`,
    )
  return {
    __esModule: true,
    pluginTransferResourceUi: (key: string) =>
      key === 'crm.contacts'
        ? {
            pluginId: 'crm',
            label: 'Contacts',
            extraSteps: [
              { id: 'consent', label: 'Consent', after: 'conflicts', component: Consent },
              { id: 'late', label: 'Too late', after: 'dryRun', component: Consent },
            ],
          }
        : null,
  }
})

import TransferLauncherProvider from '../components/transfer-launcher-provider.component'

let launcher: TransferLauncher | null = null
let accessTarget: TransferAccessTarget = { resource: 'data.dataset:ds-1', scope: 'org' }
/** What the launcher answered for `accessTarget` on the last render. */
let access: { import: boolean; export: boolean } | null = null

function PluginList() {
  launcher = useTransferLauncher()
  access = launcher
    ? { import: launcher.can('import', accessTarget), export: launcher.can('export', accessTarget) }
    : null
  return null
}

beforeEach(() => {
  mockKit.length = 0
  mockOrg = { $id: 'org-1' }
  mockGranted = new Set(['data.manage'])
  mockPermissionsLoaded = true
  mockMemberDoc = null
  mockBilling = { org: { plan: 'starter' }, ready: true }
  launcher = null
  access = null
  accessTarget = { resource: 'data.dataset:ds-1', scope: 'org' }
})

describe('the transfer launcher', () => {
  it('is null outside the console shell, so a plugin hides Import and Export', () => {
    render(<PluginList />)
    expect(launcher).toBeNull()
  })

  it('opens the import wizard on the resource and site the plugin named, in a dialog that closes', () => {
    render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(screen.queryByTestId('import-wizard')).toBeNull()
    act(() => launcher?.openImport({ resource: 'crm.contacts', scope: 'host', hostId: 'host-1', mappingZone: 'contacts' }))
    expect(screen.getByTestId('import-wizard').getAttribute('data-resource')).toBe('crm.contacts')
    expect(screen.getByRole('dialog', { name: 'Import Contacts' })).toBeTruthy()
    expect(mockKit.at(-1)?.props).toMatchObject({
      resource: 'crm.contacts',
      jobId: null,
      importMappingZone: { collection: 'contacts', hostId: 'host-1', orgId: 'org-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('import-wizard')).toBeNull()
  })

  it('opens the export dialog with the selection and the filter, and tells the plugin when an import is done', () => {
    render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    const filter = { label: 'Leads', value: { stage: 'lead' } }
    act(() => launcher?.openExport({ resource: 'crm.contacts', scope: 'org', selection: ['a', 'b'], filter }))
    expect(screen.getByTestId('export-dialog')).toBeTruthy()
    expect(mockKit.at(-1)?.props).toMatchObject({ open: true, resource: 'crm.contacts', selection: ['a', 'b'], filter })

    const onFinished = jest.fn()
    act(() => launcher?.openImport({ resource: 'crm.contacts', scope: 'org', onFinished }))
    const wizard = mockKit.filter((entry) => entry.component === 'import-wizard').at(-1)
    act(() => (wizard?.props['onDone'] as () => void)())
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('import-wizard')).toBeNull()
  })

  it('hands the wizard the plugin’s own steps that come before the review, holding Next until each is done', () => {
    render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    act(() => launcher?.openImport({ resource: 'crm.contacts', scope: 'org' }))
    const steps = () =>
      mockKit.filter((entry) => entry.component === 'import-wizard').at(-1)?.props['extraSteps'] as Array<{
        id: string
        after: string
        render(context: unknown): React.ReactElement
        problems(context: unknown): string[]
      }>
    expect(steps().map((step) => [step.id, step.after])).toEqual([['consent', 'conflicts']])
    expect(steps()[0]?.problems({})).toEqual(['Finish “Consent” to go on.'])
    const setValue = jest.fn()
    const view = render(steps()[0]!.render({ draft: { jobId: 'job-1' }, value: undefined, setValue }))
    fireEvent.click(view.getByRole('button', { name: 'Agree for job-1' }))
    expect(setValue).toHaveBeenCalledWith({ agreed: true })
    expect(steps()[0]?.problems({})).toEqual([])
  })

  it('says a member with Manage data may import and export, and a read-only member may only export', () => {
    const view = render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: true, export: true })
    mockGranted = new Set()
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: false, export: true })
  })

  it('answers false for both until the permissions answer, and off a workspace', () => {
    mockPermissionsLoaded = false
    const view = render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: false, export: false })
    mockPermissionsLoaded = true
    mockOrg = null
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: false, export: false })
  })

  it('decides a collaborator on the site named: export where they reach, never import', async () => {
    mockOrg = { $id: 'org-1', role: 'editor', orgWide: false }
    mockGranted = new Set()
    mockMemberDoc = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } }
    accessTarget = { resource: 'data.dataset:ds-1', scope: 'org', hostId: 'host-a' }
    const view = render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    // Held while their member document is read.
    expect(access).toEqual({ import: false, export: false })
    await act(async () => {})
    expect(access).toEqual({ import: false, export: true })

    accessTarget = { resource: 'data.dataset:ds-1', scope: 'org', hostId: 'host-z' }
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: false, export: false })
  })

  it('offers no CRM or dataset button on Free but the people files’ export, every one on Starter (AGL-3555, AGL-3548)', () => {
    const answers = () => {
      const out: Record<string, { import: boolean; export: boolean }> = {}
      for (const resource of ['crm.contacts', 'crm.leads', 'crm.companies', 'crm.deals', 'crm.tasks', 'crm.activities', 'crm.pipelines', 'crm.fields', 'data.dataset:ds-1', 'email.suppressions']) {
        const target = { resource, scope: 'org' as const }
        out[resource] = { import: Boolean(launcher?.can('import', target)), export: Boolean(launcher?.can('export', target)) }
      }
      return out
    }
    mockBilling = { org: { plan: 'free' }, ready: true }
    const view = render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(answers()).toEqual({
      'crm.contacts': { import: false, export: true },
      'crm.leads': { import: false, export: true },
      'crm.companies': { import: false, export: false },
      'crm.deals': { import: false, export: false },
      'crm.tasks': { import: false, export: false },
      'crm.activities': { import: false, export: false },
      'crm.pipelines': { import: false, export: false },
      'crm.fields': { import: false, export: false },
      // The Data page's `dataStore`, from Starter (AGL-3548).
      'data.dataset:ds-1': { import: false, export: false },
      // Suppressions declare no plan feature: every plan moves them.
      'email.suppressions': { import: true, export: true },
    })

    mockBilling = { org: { plan: 'starter' }, ready: true }
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    for (const [resource, answer] of Object.entries(answers())) {
      expect([resource, answer.export]).toEqual([resource, true])
    }
    expect(answers()['crm.companies']).toEqual({ import: true, export: true })

    // Until the workspace document answers, a plan-gated button is held back.
    mockBilling = { org: undefined, ready: false }
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(answers()['crm.companies']).toEqual({ import: false, export: false })
    expect(answers()['crm.contacts']).toEqual({ import: false, export: true })
    expect(answers()['data.dataset:ds-1']).toEqual({ import: false, export: false })
    expect(answers()['email.suppressions']).toEqual({ import: true, export: true })
  })

  it('offers gift cards’ Import only to a site’s admins, as the declaration’s importRoles say (AGL-3554)', () => {
    mockBilling = { org: { plan: 'business' }, ready: true }
    accessTarget = { resource: 'commerce.gift-cards', scope: 'host', hostId: 'host-a' }
    const view = render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    // No role read yet on the workspace: an org-wide member with no role is no admin.
    expect(access).toEqual({ import: false, export: true })

    mockOrg = { $id: 'org-1', role: 'admin' }
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: true, export: true })

    mockOrg = { $id: 'org-1', role: 'editor', orgWide: true }
    view.rerender(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    expect(access).toEqual({ import: false, export: true })
  })

  it('keeps one launcher while the answers stand, so a list is not re-rendered for nothing', () => {
    const seen: TransferLauncher[] = []
    function Watcher() {
      const current = useTransferLauncher()
      if (current) seen.push(current)
      return null
    }
    const view = render(
      <TransferLauncherProvider>
        <Watcher />
      </TransferLauncherProvider>,
    )
    view.rerender(
      <TransferLauncherProvider>
        <Watcher />
      </TransferLauncherProvider>,
    )
    expect(new Set(seen).size).toBe(1)
  })

  it('opens nothing off a workspace, where there is nothing to import into', () => {
    mockOrg = null
    render(
      <TransferLauncherProvider>
        <PluginList />
      </TransferLauncherProvider>,
    )
    act(() => launcher?.openImport({ resource: 'crm.contacts', scope: 'org' }))
    expect(screen.queryByTestId('import-wizard')).toBeNull()
  })
})
