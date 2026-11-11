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
 * "Use Aglyn's nameservers" on a registered domain's DNS section (AGL-4040).
 * Nothing changes until the owner confirms a dialog that says which records
 * stop applying; a name already on our nameservers never offers it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockEnqueue = jest.fn()
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { DnsRecordsSection } from './dns-records-section.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const ELSEWHERE = { ours: false, nameservers: ['ns1.otherhost.example'], siteConnected: true, records: [] }
const OURS = { ours: true, nameservers: ['ns1.vercel-dns.com'], siteConnected: false, records: [] }

/** GETs answer `listed`; a POST answers `posted`. */
function answers(listed: unknown, posted: { body: unknown; status?: number } = { body: { ok: true } }) {
  mockFetch.mockImplementation(async (_user: unknown, _url: string, init: RequestInit = {}) =>
    init.method === 'POST' ? json(posted.body, posted.status ?? 200) : json(listed),
  )
}

const posts = () => mockFetch.mock.calls.filter(([, , init]) => (init as RequestInit | undefined)?.method === 'POST')
const moveButton = () => screen.queryByRole('button', { name: `Use ${PLATFORM_BRAND_NAME}’s nameservers` })

beforeEach(() => {
  mockFetch.mockReset()
  mockEnqueue.mockReset()
})

describe('Use our nameservers', () => {
  it('asks first, says what stops applying, and changes nothing on cancel', async () => {
    answers(ELSEWHERE)
    render(<DnsRecordsSection orgId="org-1" domain="testbakery.com" />)
    fireEvent.click(await screen.findByRole('button', { name: `Use ${PLATFORM_BRAND_NAME}’s nameservers` }))
    expect(await screen.findByText(/such as email \(MX\) records/)).toBeTruthy()
    expect(screen.getByText(/stop using ns1\.otherhost\.example/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/such as email \(MX\) records/)).toBeNull())
    expect(posts()).toHaveLength(0)
  })

  it('moves the name on confirm, then says it is on its way', async () => {
    answers(ELSEWHERE)
    render(<DnsRecordsSection orgId="org-1" domain="testbakery.com" />)
    fireEvent.click(await screen.findByRole('button', { name: `Use ${PLATFORM_BRAND_NAME}’s nameservers` }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use them' }))
    expect(await screen.findByText(/is moving to .*nameservers\. It can take up to 48 hours/)).toBeTruthy()
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String((posts()[0][2] as RequestInit).body))).toEqual({
      orgId: 'org-1',
      domain: 'testbakery.com',
      action: 'use-our-nameservers',
    })
    expect(moveButton()).toBeNull()
    expect(mockEnqueue).toHaveBeenCalled()
  })

  it('keeps the dialog open with the reason when the registrar refuses', async () => {
    answers(ELSEWHERE, { body: { error: 'The registrar didn’t accept the nameserver change. Nothing was changed.' }, status: 409 })
    render(<DnsRecordsSection orgId="org-1" domain="testbakery.com" />)
    fireEvent.click(await screen.findByRole('button', { name: `Use ${PLATFORM_BRAND_NAME}’s nameservers` }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use them' }))
    expect(await screen.findByText(/Nothing was changed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use them' })).toBeTruthy()
  })

  it('never offers it for a name already on our nameservers', async () => {
    answers(OURS)
    render(<DnsRecordsSection orgId="org-1" domain="testbakery.com" />)
    expect(await screen.findByRole('button', { name: 'Add record' })).toBeTruthy()
    expect(moveButton()).toBeNull()
  })
})
