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
 * `/crm/settings` (AGL-2613): one switch, written to the org document by the
 * dotted path the capture door reads, and movable only by the roles the org
 * document's client rule admits.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { CrmSettingsSection } from './settings-section'

/** The caller's org role, as their own membership document answers. */
let memberRole: string | null = 'owner'

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: () => ({
    data: memberRole ? { role: memberRole } : undefined,
    status: 'success',
    fromCache: false,
  }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const LABEL = 'Create companies from work email domains'

beforeEach(() => {
  jest.clearAllMocks()
  memberRole = 'owner'
})

describe('the auto-create switch', () => {
  it('reflects the org document, off when it says nothing', () => {
    const { rerender } = render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(false)
    rerender(
      <CrmSettingsSection hostId="host-1" org={{ crm: { autoCreateCompanies: true } }} />,
    )
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).checked).toBe(true)
  })

  it('writes the switch by dotted path onto the org document, and nothing else', async () => {
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByLabelText(LABEL))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'orgs/org-1' },
      { 'crm.autoCreateCompanies': true },
    )
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/will be created/),
      expect.anything(),
    )
  })

  it('is disabled, with the reason, for a member who is not an owner or admin', () => {
    memberRole = 'editor'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Only a workspace owner or admin can change this.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(LABEL))
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('admits an admin as it admits an owner', () => {
    memberRole = 'admin'
    render(<CrmSettingsSection hostId="host-1" org={{}} />)
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).disabled).toBe(false)
    expect(screen.queryByText(/Only a workspace owner/)).toBeNull()
  })
})
