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
 * file is asked of the CRM export route for this org and the resource named;
 * a file shorter than the route promised is refused rather than saved; the
 * erasure posts the org, the address and its second typing; and nothing is
 * filed while the two typings differ.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockAuthorizedFetch = jest.fn()
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
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

import OrgPrivacyCard from '../components/settings/org-privacy-card.component'

/** A CSV with a header and `rows` people. */
const csv = (rows: number) =>
  ['email,name', ...Array.from({ length: rows }, (_, index) => `p${index}@example.com,P${index}`)]
    .join('\n')
    .concat('\n')

/** What `authorizedFetch` answers for a file: jsdom has no `Response`. */
const file = (text: string, promised: number) => ({
  ok: true,
  status: 200,
  text: async () => text,
  json: async () => ({}),
  headers: {
    get: (name: string) => (name === 'X-Aglyn-Export-Rows' ? String(promised) : null),
  },
})

/** A JSON answer with a status. */
const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
  headers: { get: () => null },
})

let saved: string[] = []

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockEnqueueSnackbar.mockReset()
  saved = []
  Object.assign(URL, {
    createObjectURL: jest.fn(() => 'blob:people'),
    revokeObjectURL: jest.fn(),
  })
  jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the people files', () => {
  it('asks the CRM export route for each file by org and resource, and saves it', async () => {
    mockAuthorizedFetch.mockResolvedValue(file(csv(2), 2))
    render(<OrgPrivacyCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Export contacts' }))
    await waitFor(() => expect(saved).toEqual(['contacts.csv']))
    expect(mockAuthorizedFetch.mock.calls[0][1]).toBe(
      '/api/crm/export?orgId=org-1&resource=contacts',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export leads' }))
    await waitFor(() => expect(saved).toEqual(['contacts.csv', 'leads.csv']))
    expect(mockAuthorizedFetch.mock.calls[1][1]).toBe('/api/crm/export?orgId=org-1&resource=leads')
  })

  it('refuses a file shorter than the route promised, saving nothing', async () => {
    mockAuthorizedFetch.mockResolvedValue(file(csv(1), 3))
    render(<OrgPrivacyCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Export contacts' }))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(String(mockEnqueueSnackbar.mock.calls[0][0])).toMatch(/^Export incomplete — 1 of 3 rows/)
    expect(saved).toEqual([])
  })

  it('says what the route refused, in its words', async () => {
    mockAuthorizedFetch.mockResolvedValue(answer(404, { error: 'Not found' }))
    render(<OrgPrivacyCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Export leads' }))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Not found', expect.anything()),
    )
    expect(saved).toEqual([])
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
