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
import type { OutreachLinkDomain, OutreachLinkDomainsResponse } from '../model/outreach-api'
import { LINK_DOMAIN_LABELS, OutreachLinkDomainsCard } from './link-domains-card'

/**
 * THE LINK DOMAINS CARD (AGL-3306): what a tracked link reads now, the DNS a
 * host still needs, and the actions only an owner or admin may take.
 */

const mockApi = {
  readLinkDomains: jest.fn(),
  changeLinkDomain: jest.fn(),
}
const mockConfirm = jest.fn()
const mockEnqueueSnackbar = jest.fn()

jest.mock('./use-outreach-api', () => ({
  useOutreachApi: () => mockApi,
  OutreachRouteError: class extends Error {},
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

const pending: OutreachLinkDomain = {
  domain: 'acme.io',
  host: 'links.acme.io',
  status: 'records-issued',
  records: [
    { type: 'CNAME', name: 'links.acme.io', value: 'cname.vercel-dns.com', required: false, note: 'Counts link clicks.' },
  ],
  detail: null,
  linkPrefix: 'https://app.example.com/api/outreach/l/',
  checkedAtMs: null,
  verifiedAtMs: null,
}

const answer = (domains: OutreachLinkDomain[], canManage = true): OutreachLinkDomainsResponse => ({
  ok: true,
  domains,
  canManage,
})

beforeEach(() => {
  jest.clearAllMocks()
})

it('shows what links read now and the record still to publish', async () => {
  mockApi.readLinkDomains.mockResolvedValue(answer([pending]))
  render(<OutreachLinkDomainsCard orgId="org1" />)
  expect(await screen.findByText('links.acme.io')).toBeTruthy()
  expect(screen.getByText('Waiting for DNS')).toBeTruthy()
  expect(screen.getByText('cname.vercel-dns.com')).toBeTruthy()
  expect(screen.getByText('Links in email from acme.io read https://app.example.com/api/outreach/l/…')).toBeTruthy()
})

it('checks a host and says when links move onto it', async () => {
  mockApi.readLinkDomains.mockResolvedValue(answer([pending]))
  mockApi.changeLinkDomain.mockResolvedValue({
    ...answer([{ ...pending, status: 'verified', records: [], linkPrefix: 'https://links.acme.io/' }]),
    domain: 'acme.io',
  })
  render(<OutreachLinkDomainsCard orgId="org1" />)
  fireEvent.click(await screen.findByRole('button', { name: LINK_DOMAIN_LABELS.check('links.acme.io') }))
  await waitFor(() => expect(mockApi.changeLinkDomain).toHaveBeenCalledWith('check', 'acme.io'))
  expect(await screen.findByText('Verified')).toBeTruthy()
  expect(mockEnqueueSnackbar).toHaveBeenCalledWith('links.acme.io is verified. Tracked links now use it.', {
    variant: 'success',
  })
})

it('asks before removing, and removes nothing when declined', async () => {
  mockApi.readLinkDomains.mockResolvedValue(answer([pending]))
  mockConfirm.mockRejectedValue(new Error('cancelled'))
  render(<OutreachLinkDomainsCard orgId="org1" />)
  fireEvent.click(await screen.findByRole('button', { name: LINK_DOMAIN_LABELS.remove('links.acme.io') }))
  await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
  expect(mockApi.changeLinkDomain).not.toHaveBeenCalled()
})

it('offers a member who cannot manage only the check', async () => {
  mockApi.readLinkDomains.mockResolvedValue(
    answer([{ ...pending, status: 'not-set-up', records: [] }, { ...pending, domain: 'b.io', host: 'links.b.io' }], false),
  )
  render(<OutreachLinkDomainsCard orgId="org1" />)
  await screen.findByText('links.b.io')
  expect(screen.queryByRole('button', { name: LINK_DOMAIN_LABELS.setUp('links.acme.io') })).toBeNull()
  expect(screen.queryByRole('button', { name: LINK_DOMAIN_LABELS.remove('links.b.io') })).toBeNull()
  expect(screen.getByRole('button', { name: LINK_DOMAIN_LABELS.check('links.b.io') })).toBeTruthy()
})
