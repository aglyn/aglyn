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
 */

import { useTransferLauncher, type TransferLauncher } from '@aglyn/aglyn'
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

let mockOrg: { $id: string } | null = { $id: 'org-1' }
jest.mock('../hooks/use-url-names-org', () => ({
  __esModule: true,
  useUrlNamedOrg: () => mockOrg,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'token-1' } }),
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

function PluginList() {
  launcher = useTransferLauncher()
  return null
}

beforeEach(() => {
  mockKit.length = 0
  mockOrg = { $id: 'org-1' }
  launcher = null
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
