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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import type { DomainRegistrationView } from '../model/registration'
import DomainsPage, { domainStatus, renewsLine } from './domains-page.component'
import { DomainsRequestError, type WorkspaceAnswer, type WorkspaceDomainRow } from './domains-api'
import { swapNotice, transferStateSentence } from './bought-domain-panel.component'
import { contactTakesEffectSentence } from './registrant-contact-section.component'

/**
 * The workspace's Domains page (AGL-4040): every name the workspace holds,
 * sortable, with the page's actions in its header, and one name's page with
 * connect, transfer out, the contact and the DNS records.
 */

const request = jest.fn()
const push = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./domains-api', () => ({
  ...jest.requireActual('./domains-api'),
  useDomainsFetch: () => request,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push }),
  usePathname: () => '/test-org/domains',
}))

const VIEW: DomainRegistrationView = {
  domain: 'testbakery.com',
  hostId: 'host-1',
  status: 'active',
  autoRenew: true,
  renewalCents: 1599,
  expiresAtMs: Date.parse('2027-10-19T12:00:00Z'),
  registeredAtMs: 1,
  registrantEmail: 'alex@testbakery.com',
  verifyByMs: null,
  verificationEmail: null,
  renewalFailing: false,
  failure: null,
  registrantName: 'Alex Test',
  contactVerified: true,
  contactPendingSinceMs: null,
  contactRejectedAtMs: null,
  origin: 'purchase',
  transferStatus: null,
  transferStartedAtMs: null,
}

const ROWS: WorkspaceDomainRow[] = [
  { ...VIEW, connected: true },
  { ...VIEW, domain: 'spare.com', hostId: null, connected: false, renewalCents: 2599 },
  {
    ...VIEW,
    domain: 'moving.com',
    hostId: null,
    status: 'transferring-in',
    origin: 'transfer-in',
    connected: false,
    expiresAtMs: null,
    transferStatus: 'pending_unlock',
    transferStartedAtMs: Date.parse('2026-10-20T00:00:00Z'),
  },
]

const READY: WorkspaceAnswer = {
  configured: true,
  entitled: true,
  billingPermission: true,
  canBuy: true,
  refusal: null,
  rows: ROWS,
  siteDomains: { 'host-1': 'testbakery.com', 'host-2': 'otherbakery.com' },
  contactDefaults: { firstName: 'Alex', lastName: 'Test', email: 'alex@testbakery.com' },
}

const orgMount = {
  orgId: 'org-1',
  orgSlug: 'test-org',
  hosts: [
    { id: 'host-1', name: 'Test Bakery', subdomain: 'test-bakery' },
    { id: 'host-2', name: 'Other Bakery', subdomain: 'other-bakery' },
  ],
  hostsReady: true,
  hostsPath: '/test-org/hosts',
  billingPath: '/test-org/billing',
}

type Handler = (options: { query?: Record<string, string>; body?: Record<string, unknown> }) => unknown

function answer(handlers: Partial<Record<string, Handler>> = {}, workspace: Partial<WorkspaceAnswer> = {}) {
  request.mockImplementation(async (route: string, options: Parameters<Handler>[0] = {}) => {
    const handler = handlers[route]
    if (handler) return handler(options)
    if (route === DOMAINS_API_ROUTES.workspace) return { ...READY, ...workspace }
    if (route === DOMAINS_API_ROUTES.contact) {
      return {
        contact: { firstName: 'Alex', lastName: 'Test', email: 'alex@testbakery.com' },
        stored: false,
        pendingSinceMs: null,
        rejectedAtMs: null,
        takesEffectAtMs: Date.parse('2027-09-19T12:00:00Z'),
        autoRenew: true,
        expiresAtMs: VIEW.expiresAtMs,
        verification: { verified: true, verifyByMs: null, email: null },
      }
    }
    if (route === DOMAINS_API_ROUTES.dns) {
      return {
        ours: true,
        nameservers: ['ns1.vercel-dns.com'],
        siteConnected: true,
        records: [
          { id: 'rec_a', type: 'A', name: '', value: '76.76.21.21', ttl: 60, priority: null, managed: true, editable: true },
          { id: 'rec_mx', type: 'MX', name: '', value: 'mx.example.com', ttl: 3600, priority: 10, managed: false, editable: true },
        ],
      }
    }
    throw new Error(`unexpected ${route}`)
  })
}

const page = (segments: string[] = []) => (
  <DomainsPage
    hostId={null}
    orgMount={orgMount}
    entitled
    basePath="/test-org/domains"
    segments={segments}
  />
)

beforeEach(() => {
  request.mockReset()
  push.mockReset()
  enqueueSnackbar.mockReset()
})

describe('the Domains page list', () => {
  it('lists every name with its site, status, renewal and price, and opens one', async () => {
    answer()
    render(page())
    expect(await screen.findByText('testbakery.com')).toBeTruthy()
    expect(screen.getByText('Test Bakery')).toBeTruthy()
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
    expect(screen.getByText('Moving here')).toBeTruthy()
    expect(screen.getByText('$25.99 a year')).toBeTruthy()
    fireEvent.click(screen.getByText('spare.com'))
    expect(push).toHaveBeenCalledWith('/test-org/domains/spare.com')
  })

  it('puts Buy a domain and Transfer a domain in in the card header', async () => {
    answer()
    render(page())
    expect(await screen.findByRole('button', { name: 'Buy a domain' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Transfer a domain in' })).toBeTruthy()
  })

  it('sorts by every column', async () => {
    answer()
    render(page())
    await screen.findByText('testbakery.com')
    for (const header of ['Domain', 'Site', 'Status', 'Expires or renews', 'Auto-renew', 'Price at renewal']) {
      const cell = screen.getByRole('columnheader', { name: new RegExp(header) })
      expect(cell.getAttribute('aria-sort')).not.toBeNull()
    }
    fireEvent.click(screen.getByRole('columnheader', { name: /Price at renewal/ }))
    await waitFor(() => {
      const cells = screen.getAllByRole('row').slice(1).map((row) => within(row).queryByText(/\.com$/)?.textContent)
      expect(cells[0]).not.toBe('spare.com')
    })
  })

  it('says the plan is why buying is off, and keeps the names on screen', async () => {
    answer({}, { entitled: false, canBuy: false })
    render(page())
    expect(await screen.findByText(/included from the Starter plan/)).toBeTruthy()
    expect(screen.getByText('testbakery.com')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Buy a domain' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('prices a transfer in before asking for the code, and explains the wait', async () => {
    answer({
      [DOMAINS_API_ROUTES.transferInQuote]: () => ({ domain: 'elsewhere.com', priceCents: 1599, renewalCents: 1599 }),
    })
    render(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer a domain in' }))
    expect(screen.getByText(/up to about 5 to 7 days/)).toBeTruthy()
    expect(screen.getByText(/keeps its current DNS until it arrives/)).toBeTruthy()
    expect(screen.queryByLabelText(/Transfer code/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'elsewhere.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check price' }))
    expect(await screen.findByText(/Transfer: \$15.99, which adds a year/)).toBeTruthy()
    expect(screen.getByLabelText(/Transfer code/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Transfer for $15.99' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('one domain’s page', () => {
  it('connects it to a site, naming the domain it replaces before confirming', async () => {
    const connect = jest.fn(() => ({ registration: VIEW, replaced: 'otherbakery.com' }))
    answer({ [DOMAINS_API_ROUTES.connect]: connect })
    render(page(['spare.com']))
    fireEvent.click(await screen.findByRole('button', { name: 'Connect to a site' }))
    fireEvent.mouseDown(screen.getByLabelText('Site'))
    fireEvent.click(await screen.findByRole('option', { name: /Other Bakery/ }))
    expect(await screen.findByText(/Other Bakery uses otherbakery.com now/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replace otherbakery.com' }))
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith({ body: { orgId: 'org-1', domain: 'spare.com', siteId: 'host-2' } }),
    )
  })

  it('shows the registry’s transfer-out date when the name is locked', async () => {
    answer({
      [DOMAINS_API_ROUTES.transferOut]: () => {
        throw new DomainsRequestError(
          'The domain registry locks a domain for a while after it is registered or moved. testbakery.com can be moved from Dec 18, 2026.',
          409,
          { code: 'locked' },
        )
      },
    })
    render(page(['testbakery.com']))
    fireEvent.click(await screen.findByRole('button', { name: 'Move to another registrar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show transfer code' }))
    expect(await screen.findByText(/can be moved from Dec 18, 2026/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /unlock/i })).toBeNull()
  })

  it('shows the contact with ICANN’s check, and the records Aglyn keeps as read-only', async () => {
    answer()
    render(page(['testbakery.com']))
    expect(await screen.findByText('Email confirmed with ICANN')).toBeTruthy()
    expect(await screen.findByText('Managed by Aglyn')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add record' })).toBeTruthy()
    expect(screen.getByText('Connected to Test Bakery.')).toBeTruthy()
  })

  it('explains, and draws no editor, for a name on another provider’s nameservers', async () => {
    answer({
      [DOMAINS_API_ROUTES.dns]: () => ({ ours: false, nameservers: ['ns1.otherhost.example'], siteConnected: false, records: [] }),
    })
    render(page(['spare.com']))
    expect(await screen.findByText(/uses ns1.otherhost.example for its DNS/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add record' })).toBeNull()
  })

  it('adds a record from ordinary fields', async () => {
    const dns = jest.fn((options: { query?: Record<string, string>; body?: Record<string, unknown> }) =>
      options.body
        ? { ok: true }
        : { ours: true, nameservers: [], siteConnected: false, records: [] },
    )
    answer({ [DOMAINS_API_ROUTES.dns]: dns })
    render(page(['spare.com']))
    fireEvent.click(await screen.findByRole('button', { name: 'Add record' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '_dmarc' } })
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'v=DMARC1; p=none' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add record' }))
    await waitFor(() =>
      expect(dns).toHaveBeenCalledWith({
        body: {
          orgId: 'org-1',
          domain: 'spare.com',
          action: 'create',
          record: { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none', ttl: null },
        },
      }),
    )
  })

  it('says a name is not in the workspace', async () => {
    answer()
    render(page(['unknown.com']))
    expect(await screen.findByText('That domain isn’t in this workspace.')).toBeTruthy()
  })
})

describe('sentences', () => {
  it('names each status and the renewal line', () => {
    expect(domainStatus({ ...ROWS[0] }).label).toBe('Active')
    expect(domainStatus({ ...ROWS[0], renewalFailing: true }).label).toBe('Renewal failing')
    expect(domainStatus({ ...ROWS[0], status: 'registering', origin: 'transfer-in' }).label).toBe('Starting transfer')
    expect(renewsLine(ROWS[0])).toMatch(/^Renews /)
    expect(renewsLine({ ...ROWS[0], autoRenew: false })).toMatch(/^Expires /)
    expect(renewsLine(ROWS[2])).toBe('—')
  })

  it('says what is left after a move onto a site did not finish', () => {
    expect(swapNotice({ domain: 'a.com', failure: 'swap-timed-out' })).toMatch(/was undone/)
    expect(swapNotice({ domain: 'a.com', failure: 'swap-undo-failed:old.com' })).toMatch(/Connect old.com to it again/)
    expect(swapNotice({ domain: 'a.com', failure: 'swap-undo-failed:a.com' })).toMatch(/Connect it to a site again/)
    expect(swapNotice({ domain: 'a.com', failure: null })).toBeNull()
  })

  it('says where a transfer stands, and when a contact change takes effect', () => {
    expect(transferStateSentence('pending_unlock')).toMatch(/unlock it there/)
    expect(transferStateSentence(null)).toMatch(/about a week/)
    expect(contactTakesEffectSentence({ takesEffectAtMs: Date.parse('2027-09-19T12:00:00Z'), autoRenew: true, expiresAtMs: 1 })).toMatch(
      /next renewal, around Sep 19, 2027/,
    )
    expect(contactTakesEffectSentence({ takesEffectAtMs: null, autoRenew: false, expiresAtMs: Date.parse('2027-10-19T12:00:00Z') })).toMatch(
      /Auto-renew is off/,
    )
  })
})
