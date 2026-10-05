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
 * A WORKSPACE'S PRIVACY OBLIGATIONS, OUTSIDE THE CRM (AGL-2839).
 *
 * Settings → Privacy hands over the contacts and leads a workspace holds and
 * files a person's erasure by address, on every plan. What must hold: each
 * file opens the console's export dialog on the CRM's transfer resource over
 * the whole workspace (AGL-3552), offered to exactly whom the transfer gate
 * admits — "Manage data", as the retired `/api/crm/export` asked — and on no
 * plan's say-so; the erasure posts the org, the address and its second
 * typing; and nothing is filed while the two typings differ.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockAuthorizedFetch = jest.fn()
const mockEnqueueSnackbar = jest.fn()
const mockOpenExport = jest.fn()
/** The launcher the shell hands down; `null` outside the shell. */
let mockLauncher: { openExport: jest.Mock; can: (action: string, target: { resource: string }) => boolean } | null

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => mockLauncher,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'owner-1' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1' } }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

import { transferAccessPermissions } from '@aglyn/aglyn/data-transfer'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import OrgPrivacyCard from '../components/settings/org-privacy-card.component'

/** A JSON answer with a status. */
const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
  headers: { get: () => null },
})

/** The resources the transfer gate's `data.manage` holders may export, as the shell answers `can`. */
let mockExportable = new Set(['crm.contacts', 'crm.leads'])

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockEnqueueSnackbar.mockReset()
  mockOpenExport.mockReset()
  mockExportable = new Set(['crm.contacts', 'crm.leads'])
  mockLauncher = {
    openExport: mockOpenExport,
    can: (action, target) => action === 'export' && mockExportable.has(target.resource),
  }
})

describe('the people files', () => {
  const exportButton = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

  it('opens the export dialog on every contact and every lead of the workspace', () => {
    render(<OrgPrivacyCard />)

    fireEvent.click(exportButton('Export contacts'))
    expect(mockOpenExport).toHaveBeenLastCalledWith({
      resource: 'crm.contacts',
      scope: 'org',
      title: 'Export every contact',
    })

    fireEvent.click(exportButton('Export leads'))
    expect(mockOpenExport).toHaveBeenLastCalledWith({
      resource: 'crm.leads',
      scope: 'org',
      title: 'Export every lead',
    })
    // The dialog is the launcher's: the card itself fetches nothing.
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('offers neither file to someone the export route would refuse', () => {
    mockExportable = new Set()
    render(<OrgPrivacyCard />)
    expect(exportButton('Export contacts').disabled).toBe(true)
    expect(exportButton('Export leads').disabled).toBe(true)
    fireEvent.click(exportButton('Export contacts'))
    expect(mockOpenExport).not.toHaveBeenCalled()
  })

  it('opens nothing outside the console shell, which holds no launcher', () => {
    mockLauncher = null
    render(<OrgPrivacyCard />)
    expect(exportButton('Export contacts').disabled).toBe(true)
    expect(exportButton('Export leads').disabled).toBe(true)
  })

  /*
   * PARITY WITH THE RETIRED ROUTE. `/api/crm/export` admitted a member
   * holding "Manage data" to the contacts and leads files and asked no plan
   * and no release flag. The transfer gate asks what the resource declares,
   * so the two resources must declare no narrower reader (which would hand
   * the file to members the old route refused) and no other permission
   * (which would take it from members it admitted).
   */
  it('asks "Manage data" of both files, exactly as the retired route did', () => {
    for (const key of ['crm.contacts', 'crm.leads']) {
      const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find((resource) => resource.key === key)
      expect(declared).toBeDefined()
      expect(transferAccessPermissions('export', declared)).toEqual(['data.manage'])
    }
  })
})

describe('erasing a person', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const eraseButton = () =>
    screen.getByRole('button', { name: 'Erase permanently' }) as HTMLButtonElement

  it('files by address, posting the org, the address and its second typing', async () => {
    mockAuthorizedFetch.mockResolvedValue(answer(200, { ok: true, alreadyPending: false }))
    render(<OrgPrivacyCard />)
    type('Email address', 'jane@example.com')
    type('Type the email address again', 'jane@example.com')
    fireEvent.click(eraseButton())

    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockAuthorizedFetch.mock.calls[0]
    expect(url).toBe('/api/crm/erase-person')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      email: 'jane@example.com',
      confirmEmail: 'jane@example.com',
    })
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Erasure requested — it runs with the nightly job',
        expect.anything(),
      ),
    )
  })

  it('files nothing while the two typings differ', () => {
    render(<OrgPrivacyCard />)
    type('Email address', 'jane@example.com')
    type('Type the email address again', 'jane@example.org')
    expect(eraseButton().disabled).toBe(true)
    fireEvent.click(eraseButton())
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('shows the route’s refusal in its own words', async () => {
    mockAuthorizedFetch.mockResolvedValue(
      answer(403, { error: 'Only a workspace admin can erase a person from the workspace' }),
    )
    render(<OrgPrivacyCard />)
    type('Email address', 'jane@example.com')
    type('Type the email address again', 'jane@example.com')
    fireEvent.click(eraseButton())
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Only a workspace admin can erase a person from the workspace',
        expect.anything(),
      ),
    )
  })
})
