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
import type { OutreachDoNotContactDomainEntry } from '../model/outreach.types'
import {
  DO_NOT_CONTACT_DOMAIN_LABELS,
  OutreachDoNotContactDomainsCard,
} from './do-not-contact-domains'
import type { OutreachLoad } from './use-outreach-data'

/**
 * Sequences → Compliance → Do not contact domains (AGL-3244): the list as
 * it stands, with why each domain is on it; adding one, spelled the way
 * the route stores it; and taking one off. The route and the live list are
 * stubbed at the card's two hooks.
 */

const mockApi = { changeDoNotContactDomain: jest.fn() }
let mockListed: OutreachLoad<OutreachDoNotContactDomainEntry[]>
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => mockApi,
}))
jest.mock('./use-outreach-data', () => ({
  useOutreachDoNotContactDomains: () => mockListed,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-rep' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  MdiIcon: () => null,
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const entry = (overrides: Partial<OutreachDoNotContactDomainEntry> = {}): OutreachDoNotContactDomainEntry => ({
  domain: 'kcorp.example',
  reason: 'gateway_block',
  source: 'runtime',
  addedByUid: null,
  addedAtMs: Date.UTC(2026, 8, 22, 15, 0),
  enrollmentId: 'seq-1_c-1',
  sequenceId: 'seq-1',
  detail: '550 permanent failure for one or more recipients (the address:blocked)',
  ...overrides,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockListed = { status: 'ready', data: [] }
})

describe('Do not contact domains (AGL-3244)', () => {
  it('lists each domain with why it is there, and says when there are none', () => {
    mockListed = {
      status: 'ready',
      data: [entry(), entry({ domain: 'other.example', reason: 'manual', source: 'member', addedByUid: 'uid-rep', detail: null })],
    }
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    const list = screen.getByRole('list', { name: 'Do not contact domains' })
    expect(list.textContent).toContain('kcorp.example')
    expect(list.textContent).toContain('Its mail gateway blocked the sender')
    expect(list.textContent).toContain('(the address:blocked)')
    expect(list.textContent).toContain('other.example')
    expect(list.textContent).toContain('Added by a member')
    mockListed = { status: 'ready', data: [] }
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    expect(screen.getByText('No domains yet.')).toBeTruthy()
  })

  it('adds a domain, spelled the way the route stores it, and clears the field', async () => {
    mockApi.changeDoNotContactDomain.mockResolvedValue({ ok: true, changed: true, domain: 'kcorp.example', domains: [] })
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    const add = screen.getByRole('button', { name: DO_NOT_CONTACT_DOMAIN_LABELS.add }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    const field = screen.getByLabelText(DO_NOT_CONTACT_DOMAIN_LABELS.field) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'not a domain' } })
    expect(add.disabled).toBe(true)
    expect(screen.getByText('That is not a domain.')).toBeTruthy()
    fireEvent.change(field, { target: { value: ' https://www.KCorp.Example/about ' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(mockApi.changeDoNotContactDomain).toHaveBeenCalledWith('add', 'kcorp.example'))
    await waitFor(() => expect(field.value).toBe(''))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('kcorp.example is on the do-not-contact list.', { variant: 'success' })
  })

  it('takes a domain off by name', async () => {
    mockListed = { status: 'ready', data: [entry()] }
    mockApi.changeDoNotContactDomain.mockResolvedValue({ ok: true, changed: true, domain: 'kcorp.example', domains: [] })
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    fireEvent.click(screen.getByRole('button', { name: DO_NOT_CONTACT_DOMAIN_LABELS.remove('kcorp.example') }))
    await waitFor(() => expect(mockApi.changeDoNotContactDomain).toHaveBeenCalledWith('remove', 'kcorp.example'))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('kcorp.example is off the do-not-contact list.', { variant: 'success' })
  })

  it('says the route’s own sentence when a change is refused', async () => {
    mockApi.changeDoNotContactDomain.mockRejectedValue(new Error('Your role does not include Use Sequences.'))
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    fireEvent.change(screen.getByLabelText(DO_NOT_CONTACT_DOMAIN_LABELS.field), { target: { value: 'kcorp.example' } })
    fireEvent.click(screen.getByRole('button', { name: DO_NOT_CONTACT_DOMAIN_LABELS.add }))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Your role does not include Use Sequences.', {
        variant: 'error',
        allowDuplicate: true,
      }),
    )
  })

  it('shows progress, and a refusal, for the list itself', () => {
    mockListed = { status: 'loading', data: [] }
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    expect(screen.getByRole('status').textContent).toContain('Loading domains')
    mockListed = { status: 'refused', data: [] }
    render(<OutreachDoNotContactDomainsCard orgId="org-1" />)
    expect(screen.queryByRole('list', { name: 'Do not contact domains' })).toBeNull()
  })
})
