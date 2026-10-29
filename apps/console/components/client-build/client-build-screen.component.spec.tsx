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
 * The one-screen build for a client (AGL-3958), at phone width: from the
 * business details to the preview sent, with the route, the photo links and
 * the site creation answered by doubles. The guided start itself is the AI
 * plugin's, pinned in its own spec; here the zone is a stand-in that reports
 * what it was handed.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSnackbar = jest.fn()
const mockPosts: Array<{ url: string; body: Record<string, unknown> }> = []
let mockRecord: Record<string, unknown> | null = null
let mockCapabilities = { domainSearch: false, text: true, email: true }
let mockWidgets: Array<{ widgetId: string }> = []
let mockSite: Record<string, unknown> = { subdomain: 'harbor-plumbing', screens: {} }
let mockZoneProps: Record<string, unknown> | null = null
let mockHandoffProps: Record<string, unknown> | null = null
const mockStarter = jest.fn(async (): Promise<'provisioned' | 'unchanged' | 'failed'> => 'provisioned')

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUserObject }),
}))
const mockUserObject = { uid: 'staff-1' }
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))
jest.mock('../../hooks/use-is-staff', () => ({ __esModule: true, useIsStaff: () => true }))
jest.mock('../../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', slug: 'harbor' } }),
}))
jest.mock('../../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { name: 'Harbor Plumbing' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../../hooks/use-host', () => ({
  __esModule: true,
  useHost: () => ({ doc: { data: mockSite, status: 'success' } }),
}))
jest.mock('../../utils/host-first-run', () => ({
  __esModule: true,
  requestStarterSiteOutcome: (...args: unknown[]) => mockStarter(...(args as [])),
}))
jest.mock('../org-owner-handoff.component', () => ({
  __esModule: true,
  default: (props: { orgId: string }) => {
    mockHandoffProps = props
    return <button type="button">{`Hand off ${props.orgId}`}</button>
  },
}))
jest.mock('../plugin-widget-slot.component', () => ({
  __esModule: true,
  useSlotWidgets: () => ({ widgets: mockWidgets, ready: true }),
  default: (props: Record<string, unknown>) => {
    mockZoneProps = props
    return <div data-testid="guided-start" />
  },
}))
jest.mock('@aglyn/shared-ui-jsx/components/prerequisite-notice.component', () => ({
  __esModule: true,
  PrerequisiteNotice: ({ children, href }: { children: ReactNode; href?: string }) => (
    <div role="note" data-href={href}>
      {children}
    </div>
  ),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    mockPosts.push({ url, body })
    if (url === '/api/hosts/validate-name') return reply(200, { subdomainTaken: false })
    if (url === '/api/hosts/create') return reply(200, { hostId: 'host-1', subdomain: body['subdomain'] })
    if (url === '/api/media/photo-links') {
      if (body['action'] === 'create') {
        return reply(200, { linkId: 'l1', url: 'https://console.example.test/p/l1#secret', expiresAt: 1 })
      }
      return reply(200, { links: [{ linkId: 'l1', createdAt: 1, expiresAt: 2, uploads: 4, remainingUploads: 36 }] })
    }
    if (url === '/api/admin/client-build') {
      const action = body['action']
      if (action === 'get') return reply(200, { record: mockRecord, capabilities: mockCapabilities })
      if (action === 'save') {
        const { action: _action, orgId: _orgId, ...patch } = body
        mockRecord = {
          intake: null,
          domain: null,
          hostId: null,
          host: null,
          jobId: null,
          starter: false,
          previewSentAt: null,
          intent: { plan: 'starter', addons: ['siteCare'], interval: 'month' },
          ...(mockRecord ?? {}),
          ...patch,
          ...(patch['hostId'] ? { host: 'harbor-plumbing' } : {}),
        }
        const domain = mockRecord['domain'] as { choice: string; name?: string } | null
        if (domain?.choice === 'register') {
          mockRecord['intent'] = { ...(mockRecord['intent'] as object), domain: { ...domain } }
        }
        return reply(200, { record: mockRecord })
      }
      if (action === 'search-domains') {
        return reply(200, {
          results: [
            { name: 'harborplumbing.com', available: true, firstYearUsd: 11.25, renewalUsd: 18.99 },
            { name: 'harborplumbing.net', available: false, firstYearUsd: 13, renewalUsd: 13 },
          ],
        })
      }
      if (action === 'send-preview') return reply(200, { emailed: true, text: 'sent' })
    }
    throw new Error(`unexpected ${url}`)
  },
}))

import { ClientBuildScreen, previewOutcomeText } from './client-build-screen.component'

const posts = (url: string, action?: string) =>
  mockPosts.filter((post) => post.url === url && (!action || post.body['action'] === action))

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

/** Phone width: the console's mobile breakpoint, where every step has to fit. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
  window.matchMedia = ((query: string) => ({
    matches: /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } })
})

beforeEach(() => {
  jest.clearAllMocks()
  mockPosts.length = 0
  mockRecord = null
  mockCapabilities = { domainSearch: false, text: true, email: true }
  mockWidgets = []
  mockSite = { subdomain: 'harbor-plumbing', screens: {} }
  mockZoneProps = null
  mockHandoffProps = null
  try {
    window.sessionStorage.clear()
  } catch {
    // Nothing kept.
  }
})

async function fillDetails() {
  render(<ClientBuildScreen />)
  await screen.findByRole('heading', { name: 'Build for a client' })
  type(/^Business name/, 'Harbor Plumbing')
  type(/^What they do/, 'a family plumbing business')
  type(/^Towns they serve/, 'Austin and Round Rock')
  type(/^Phone/, '(512) 555-0123')
  type(/^Email/, 'owner@example.com')
  type(/^Hours/, 'Mon–Fri 8–5')
  type(/In the owner’s words/, 'Three generations fixing pipes the right way.')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  })
}

describe('the client build screen (AGL-3958)', () => {
  it('asks the details once and holds Continue on what is missing', async () => {
    render(<ClientBuildScreen />)
    await screen.findByRole('heading', { name: 'Build for a client' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    })
    expect(screen.getByText('Name the business.')).toBeTruthy()
    expect(screen.getByText('Say what the business does.')).toBeTruthy()
    expect(screen.getByText(/Add a phone or an email/)).toBeTruthy()
    expect(posts('/api/admin/client-build', 'save')).toHaveLength(0)
  })

  it('without a domain search, offers only the free address and their own domain', async () => {
    await fillDetails()
    expect(posts('/api/admin/client-build', 'save')[0].body['intake']).toMatchObject({
      businessName: 'Harbor Plumbing',
      phone: '(512) 555-0123',
      ownerWords: 'Three generations fixing pipes the right way.',
    })
    await screen.findByRole('radio', { name: 'Use the free address for now' })
    expect(screen.queryByRole('radio', { name: 'Find a domain to buy' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'They already have a domain' }))
    type(/^Their domain/, 'https://www.HarborPlumbing.com/')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    })
    expect(posts('/api/admin/client-build', 'save')[1].body['domain']).toEqual({
      choice: 'own',
      name: 'harborplumbing.com',
    })
  })

  it('with a domain search, searches as staff type and records the pick with both prices, buying nothing', async () => {
    mockCapabilities = { ...mockCapabilities, domainSearch: true }
    await fillDetails()
    fireEvent.click(await screen.findByRole('radio', { name: 'Find a domain to buy' }))
    // The first search starts from the business name.
    const results = await screen.findByRole('list', { name: 'Domains found' }, { timeout: 3_000 })
    expect(posts('/api/admin/client-build', 'search-domains')[0].body['query']).toBe('harborplumbing')
    expect(within(results).getByText('$11.25 the first year, then $18.99 a year')).toBeTruthy()
    expect(within(results).getByText('Taken')).toBeTruthy()
    fireEvent.click(within(results).getByRole('button', { name: 'Pick harborplumbing.com' }))
    expect(screen.getByText(/Nothing is bought here/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    })
    expect(posts('/api/admin/client-build', 'save')[1].body['domain']).toEqual({
      choice: 'register',
      name: 'harborplumbing.com',
      firstYearUsd: 11.25,
      renewalUsd: 18.99,
    })
  })

  it('creates the site, shows the photo QR, counts the photos, then opens the guided start with the intake', async () => {
    mockWidgets = [{ widgetId: 'ai-site-start' }]
    await fillDetails()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    })
    // The site's name and address follow the business name.
    expect(await screen.findByDisplayValue('harbor-plumbing')).toBeTruthy()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Create the site' }) as HTMLButtonElement).disabled).toBe(false),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create the site' }))
    })
    // Created empty, for the guided start: no starter is asked for.
    expect(posts('/api/hosts/create')[0].body).toEqual({
      displayName: 'Harbor Plumbing',
      subdomain: 'harbor-plumbing',
      orgId: 'org-1',
    })
    expect(posts('/api/admin/client-build', 'save').at(-1)?.body['hostId']).toBe('host-1')
    expect(await screen.findByTitle('Photo link QR code')).toBeTruthy()
    expect(await screen.findByText('4 photos received.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open the guided start' }))
    expect(screen.getByTestId('guided-start')).toBeTruthy()
    expect(mockZoneProps).toMatchObject({ slot: 'hostFirstRun', hostId: 'host-1', orgId: 'org-1', host: 'harbor-plumbing' })
    const clientBuild = mockZoneProps?.['clientBuild'] as {
      intake: Record<string, string>
      onStarted: (job: { id: string }) => void
    }
    expect(clientBuild.intake).toMatchObject({ businessName: 'Harbor Plumbing', towns: 'Austin and Round Rock' })
    await act(async () => {
      clientBuild.onStarted({ id: 'job-1' })
    })
    expect(posts('/api/admin/client-build', 'save').at(-1)?.body).toMatchObject({ jobId: 'job-1' })
    await act(async () => {
      ;(mockZoneProps?.['leave'] as () => void)()
    })
    expect(await screen.findByText(/Building the site/)).toBeTruthy()
  })

  it('says what the guided start needs when the workspace cannot run it, and offers the starter', async () => {
    mockRecord = {
      intake: {
        businessName: 'Harbor Plumbing',
        whatTheyDo: 'plumbing',
        towns: '',
        phone: '',
        email: 'owner@example.com',
        hours: '',
        ownerWords: '',
      },
      domain: { choice: 'free' },
      hostId: 'host-1',
      host: 'harbor-plumbing',
      jobId: null,
      previewSentAt: null,
      intent: { plan: 'starter', addons: ['siteCare'], interval: 'month' },
    }
    const view = render(<ClientBuildScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    const note = await screen.findByRole('note')
    expect(note.textContent).toMatch(/needs Aglyn AI/)
    expect(note.getAttribute('data-href')).toBe('/admin/orgs/org-1')
    expect((screen.getByRole('button', { name: 'Open the guided start' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use the starter site' }))
    })
    // The starter path from here chooses no style; Create site's own style view does (AGL-4049).
    expect(mockStarter).toHaveBeenCalledWith(mockUserObject, 'host-1', { style: undefined })
    expect(await screen.findByRole('button', { name: /Email the preview/ })).toBeTruthy()
    // Recorded, so a reload (or a second phone) resumes at the send step.
    expect(posts('/api/admin/client-build', 'save').at(-1)?.body).toMatchObject({ starter: true })
    view.unmount()
    render(<ClientBuildScreen />)
    expect(await screen.findByRole('button', { name: /Email the preview/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use the starter site' })).toBeNull()
  })

  it('saves the starter choice only once the starter exists, and offers a retry when it fails', async () => {
    mockRecord = {
      intake: {
        businessName: 'Harbor Plumbing',
        whatTheyDo: 'plumbing',
        towns: '',
        phone: '',
        email: 'owner@example.com',
        hours: '',
        ownerWords: '',
      },
      domain: { choice: 'free' },
      hostId: 'host-1',
      host: 'harbor-plumbing',
      jobId: null,
      starter: false,
      previewSentAt: null,
      intent: { plan: 'starter', addons: ['siteCare'], interval: 'month' },
    }
    mockStarter.mockResolvedValueOnce('failed')
    render(<ClientBuildScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use the starter site' }))
    })
    // The failure is said, with a retry; nothing is saved and the step stays.
    expect(await screen.findByText('The starter site could not be added. Try again.')).toBeTruthy()
    expect(posts('/api/admin/client-build', 'save').filter((post) => 'starter' in post.body)).toHaveLength(0)
    expect(mockRecord?.['starter']).toBe(false)
    expect(screen.queryByRole('button', { name: /Email the preview/ })).toBeNull()
    // The retry succeeds: the choice is saved and the build moves on to send.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(mockStarter).toHaveBeenCalledTimes(2)
    expect(posts('/api/admin/client-build', 'save').at(-1)?.body).toMatchObject({ starter: true })
    expect(await screen.findByRole('button', { name: /Email the preview/ })).toBeTruthy()
  })

  it('holds the preview until the site is published, then texts and emails it, beside the hand-off', async () => {
    mockRecord = {
      intake: {
        businessName: 'Harbor Plumbing',
        whatTheyDo: 'plumbing',
        towns: '',
        phone: '(512) 555-0123',
        email: 'owner@example.com',
        hours: '',
        ownerWords: '',
      },
      domain: { choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
      hostId: 'host-1',
      host: 'harbor-plumbing',
      jobId: 'job-1',
      previewSentAt: null,
      intent: {
        plan: 'starter',
        addons: ['siteCare'],
        interval: 'month',
        domain: { name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
      },
    }
    const view = render(<ClientBuildScreen />)
    const send = await screen.findByRole('button', { name: 'Text and email the preview' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Building the site/)).toBeTruthy()
    mockSite = { subdomain: 'harbor-plumbing', screens: { home: {} } }
    view.rerender(<ClientBuildScreen />)
    expect(await screen.findByText('The site is published.')).toBeTruthy()
    expect(screen.getByText('It will live at harborplumbing.com.')).toBeTruthy()
    expect(
      screen.getByText(
        'Proposes Starter with Site Care, billed monthly, and harborplumbing.com ($11.25 the first year, then $18.99 a year), bought by the owner after they subscribe.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hand off org-1' })).toBeTruthy()
    // The hand-off opens on the record held here (AGL-3995), never a refetch,
    // with the domain for the site the build made.
    expect(mockHandoffProps).toMatchObject({
      build: {
        hostId: 'host-1',
        intent: { plan: 'starter', interval: 'month', domain: { name: 'harborplumbing.com' } },
      },
      sites: [{ hostId: 'host-1', name: 'Harbor Plumbing' }],
    })
    expect(posts('/api/admin/client-build', 'get')).toHaveLength(1)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Text and email the preview' }))
    })
    expect(posts('/api/admin/client-build', 'send-preview')).toHaveLength(1)
    expect(await screen.findByText('Texted to (512) 555-0123 and emailed to owner@example.com.')).toBeTruthy()
  })

  it('says what a send came to, per channel', () => {
    const intake = { phone: '(512) 555-0123', email: 'owner@example.com' }
    expect(previewOutcomeText({ emailed: true, text: 'unavailable' }, intake)).toBe(
      'Emailed to owner@example.com. Texting is not set up here.',
    )
    expect(previewOutcomeText({ emailed: false, text: 'invalid-number' }, intake)).toBe(
      'Nothing was sent. The phone number could not be texted. The email could not be sent.',
    )
  })
})
