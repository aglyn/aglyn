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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OutreachComplianceSettingsDocument } from '../model/outreach.types'
import {
  OUTREACH_POSTAL_ADDRESS_HELP,
  OutreachComplianceSection,
} from './compliance-section'
import { OutreachRouteError } from './use-outreach-api'
import type { OutreachSettingsLoad } from './use-outreach-settings'

/**
 * Outreach → Compliance (AGL-2980) in every state it can be in: loading,
 * failed, refused, and ready — the fields, the footer preview, the warning
 * an empty address earns, and the save. The route and the settings read are
 * stubbed at the section's two hooks.
 */

const mockApi = { saveSettings: jest.fn() }
let mockLoad: OutreachSettingsLoad
const mockReload = jest.fn()
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-settings', () => ({
  useOutreachComplianceSettings: () => mockLoad,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
  }: {
    children: ReactNode
    header: ReactNode
  }) => <section aria-label={String(header)}>{children}</section>,
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const stored: OutreachComplianceSettingsDocument = {
  legalName: 'Example Co LLC',
  brandName: 'Example Co',
  postalAddress: '100 Example St\nSpringfield, IL 62701',
  allowedCountries: ['US'],
  updatedAtMs: 1,
  updatedByUid: 'uid-owner',
}

const ready = (
  settings: OutreachComplianceSettingsDocument = stored,
): OutreachSettingsLoad => ({
  status: 'ready',
  settings,
  message: null,
  reload: mockReload,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockLoad = ready()
})

describe('Sequences → Compliance: what it shows (AGL-2980)', () => {
  it('shows progress while the settings load', () => {
    mockLoad = {
      status: 'loading',
      settings: null,
      message: null,
      reload: mockReload,
    }
    render(<OutreachComplianceSection orgId="org-1" />)
    expect(screen.getByRole('status').textContent).toContain(
      'Loading compliance settings',
    )
  })

  it('offers a retry when the settings could not be read', () => {
    mockLoad = {
      status: 'error',
      settings: null,
      message: 'Sequences could not be reached. Try again.',
      reload: mockReload,
    }
    render(<OutreachComplianceSection orgId="org-1" />)
    expect(
      screen.getByText('Sequences could not be reached. Try again.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockReload).toHaveBeenCalled()
  })

  it('says a refusal in the route’s own words, with no retry', () => {
    mockLoad = {
      status: 'refused',
      settings: null,
      message: 'Your role does not include Use Sequences.',
      reload: mockReload,
    }
    render(<OutreachComplianceSection orgId="org-1" />)
    expect(
      screen.getByText('Your role does not include Use Sequences.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('fills the fields, explains the address, and previews the real footer', () => {
    render(<OutreachComplianceSection orgId="org-1" />)
    expect(
      (screen.getByLabelText('Legal name') as HTMLInputElement).value,
    ).toBe('Example Co LLC')
    expect(screen.getByText(OUTREACH_POSTAL_ADDRESS_HELP)).toBeTruthy()
    expect(screen.getByTestId('outreach-footer-preview').textContent).toBe(
      'Example Co LLC · 100 Example St, Springfield, IL 62701\n' +
        'This is a sales email from Example Co. Not interested? Reply "no" and I won\'t email again.',
    )
    expect(screen.getByText('United States')).toBeTruthy()
    expect(screen.getByText(/require a consent basis/)).toBeTruthy()
  })

  it('warns that nothing can activate while the postal address is empty', () => {
    mockLoad = ready({ ...stored, postalAddress: '' })
    render(<OutreachComplianceSection orgId="org-1" />)
    expect(
      screen.getByText(/No sequence can be activated, and no email sent/),
    ).toBeTruthy()
    expect(screen.queryByTestId('outreach-footer-preview')).toBeNull()
  })
})

describe('Sequences → Compliance: saving (AGL-2980)', () => {
  it('saves only once something changed, settled the way the route stores it', async () => {
    mockApi.saveSettings.mockResolvedValue({
      ok: true,
      changed: true,
      settings: { ...stored, legalName: 'Example Co Inc' },
    })
    render(<OutreachComplianceSection orgId="org-1" />)
    const save = screen.getByRole('button', {
      name: 'Save',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Legal name'), {
      target: { value: '  Example Co   Inc ' },
    })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() =>
      expect(mockApi.saveSettings).toHaveBeenCalledWith({
        legalName: 'Example Co Inc',
        brandName: 'Example Co',
        postalAddress: '100 Example St\nSpringfield, IL 62701',
        allowedCountries: ['US'],
      }),
    )
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Compliance settings saved.',
        { variant: 'success' },
      ),
    )
    expect(mockReload).toHaveBeenCalled()
  })

  it('shows the route’s field-level refusal beside the field', async () => {
    mockApi.saveSettings.mockRejectedValue(
      new OutreachRouteError(
        'Keep the legal name under 120 characters.',
        'invalid-settings',
        400,
        [
          {
            field: 'legalName',
            message: 'Keep the legal name under 120 characters.',
          },
        ],
      ),
    )
    render(<OutreachComplianceSection orgId="org-1" />)
    fireEvent.change(screen.getByLabelText('Legal name'), {
      target: { value: 'Example Holdings LLC' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findAllByText('Keep the legal name under 120 characters.'),
    ).not.toHaveLength(0)
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Keep the legal name under 120 characters.',
      {
        variant: 'error',
        allowDuplicate: true,
      },
    )
  })

  it('refuses to save no countries at all, saying why', () => {
    render(<OutreachComplianceSection orgId="org-1" />)
    // Backspace in an empty multi-select input removes the last chip.
    const input = screen.getByLabelText('Countries')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(
      screen.getByText('Choose at least one country a sequence may send to.'),
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
