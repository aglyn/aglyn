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
import type { ReactNode } from 'react'
import type { FunnelResult } from '../model/funnels.types'

let mockPlan: { org: Record<string, unknown> | undefined; ready: boolean }
let mockFunnels: Array<Record<string, unknown>>
let mockRole: string | undefined
const mockFetch = jest.fn()
const mockAnnounce = jest.fn()
let mockZoneProps: Record<string, Record<string, unknown>>

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useOrgPlan: () => mockPlan,
  useFirestoreDoc: () => ({ data: { memberRoles: mockRole ? { u1: mockRole } : {} }, status: 'success' }),
  useFirestoreCollection: () => ({ data: mockFunnels, status: 'success' }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  announceSiteWideChange: (...args: unknown[]) => mockAnnounce(...args),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (_user: unknown, url: string, init: { body: string }) => mockFetch(url, JSON.parse(init.body)),
}))
jest.mock('next/navigation', () => ({ useParams: () => ({ orgSlug: 'acme', host: 'shop' }) }))
const mockRecordHref = jest.fn((_kind: string, context: { orgSlug: string; host: string }, _id: string) => `/${context.orgSlug}/hosts/${context.host}/automation/actions`)
jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-routes', () => ({
  pluginRecordHref: (...args: [string, { orgSlug: string; host: string }, string]) => mockRecordHref(...args),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  limit: () => undefined,
  query: () => ({}),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children, HeaderProps }: { header: string; children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section aria-label={header}>
      <div>{HeaderProps?.action}</div>
      {children}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () =>
    function Zone(props: { slot: string } & Record<string, unknown>) {
      mockZoneProps[props.slot] = props
      return <div>{`zone-${props.slot}`}</div>
    },
}))

import { FunnelsCard } from './funnels-card.component'

const RESULT: FunnelResult = {
  funnelId: 'f1',
  from: '2026-09-07',
  to: '2026-10-06',
  entered: 200,
  completed: 30,
  overall: 0.15,
  journeysRead: 500,
  capped: false,
  computedAt: 0,
  sources: [{ source: 'google.com', entered: 120, completed: 20, conversion: 20 / 120 }],
  steps: [
    { index: 0, label: 'Pricing', visitors: 200, fromPrevious: null, fromStart: 1, dropOff: 0, medianMsFromPrevious: null },
    { index: 1, label: 'Contact', visitors: 30, fromPrevious: 0.15, fromStart: 0.15, dropOff: 170, medianMsFromPrevious: 125_000 },
  ],
}

const FUNNEL = {
  $id: 'f1',
  name: 'Pricing to contact',
  steps: [
    { type: 'page', key: '/pricing', match: 'exact', label: 'Pricing' },
    { type: 'form', key: 'f1', label: 'Contact' },
  ],
}

beforeEach(() => {
  mockPlan = { org: { plan: 'pro' }, ready: true }
  mockFunnels = []
  mockRole = 'admin'
  mockZoneProps = {}
  mockFetch.mockReset()
  mockAnnounce.mockReset()
  global.fetch = jest.fn()
})

function respond(routes: Record<string, (body: any) => { ok: boolean; body: unknown }>) {
  mockFetch.mockImplementation(async (url: string, body: unknown) => {
    const name = url.replace('/api/funnels/', '')
    const answer = routes[name]?.(body) ?? { ok: false, body: { error: 'unexpected' } }
    return { ok: answer.ok, json: async () => answer.body }
  })
}

describe('the Funnels card (AGL-3605)', () => {
  it('says which plan includes funnels, and reads nothing, on a plan without them', () => {
    mockPlan = { org: { plan: 'starter' }, ready: true }
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    expect(screen.getByText(/Funnels come with per-page analytics, included from Pro/)).toBeTruthy()
    expect(screen.queryByText('New funnel')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('makes no claim about the plan while it is loading', () => {
    mockPlan = { org: undefined, ready: false }
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    expect(screen.getByText('Checking your plan…')).toBeTruthy()
  })

  it('shows an empty state with Create with AI and New funnel for a manager', () => {
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    expect(screen.getByText(/A funnel is the steps you expect a visitor to take/)).toBeTruthy()
    expect(screen.getByText('zone-funnelsCreate')).toBeTruthy()
    expect(mockZoneProps['funnelsCreate']).toMatchObject({ hostId: 'h1', orgId: 'o1', propose: expect.any(Function) })
    expect(screen.getByText('New funnel')).toBeTruthy()
  })

  it('offers no way to create to a member who cannot', () => {
    mockRole = 'author'
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    expect(screen.queryByText('New funnel')).toBeNull()
    expect(screen.queryByText('zone-funnelsCreate')).toBeNull()
    expect(screen.getByText('A site admin or editor can create one.')).toBeTruthy()
  })

  it('shows a funnel’s result: bars, drop-off, time between steps and sources, and the ask zone', async () => {
    mockFunnels = [FUNNEL]
    respond({ results: () => ({ ok: true, body: { result: RESULT } }) })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    await waitFor(() => expect(screen.getByText(/30 of 200 visitors completed every step \(15%\)/)).toBeTruthy())
    const contact = screen.getByLabelText('Step 2: Contact')
    expect(within(contact).getByText(/15% of the previous step · 170 dropped off · median 2m 05s/)).toBeTruthy()
    expect(screen.getByText('google.com')).toBeTruthy()
    expect(mockZoneProps['funnelInsight']).toMatchObject({ funnelName: 'Pricing to contact', days: 30 })
    expect(mockFetch.mock.calls[0]).toEqual(['/api/funnels/results', expect.objectContaining({ hostId: 'h1', funnelId: 'f1' })])
  })

  it('opens the editor on an AI draft handed through the zone', async () => {
    respond({
      propose: () => ({ ok: true, body: { draft: { name: 'Drafted', steps: FUNNEL.steps }, dropped: ['This site has no page at /x.'] } }),
      inventory: () => ({ ok: true, body: { inventory: { pages: ['/pricing'], forms: [{ id: 'f1', name: 'Contact' }], services: [], products: [], overlays: [] } } }),
    })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    const propose = mockZoneProps['funnelsCreate'].propose as (brief: string) => Promise<string | null>
    expect(await propose('pricing then contact')).toBeNull()
    await waitFor(() => expect(screen.getByDisplayValue('Drafted')).toBeTruthy())
    expect(screen.getByText(/Left out of the suggestion: This site has no page at \/x\./)).toBeTruthy()
  })

  it('answers the door’s sentence when there is no draft', async () => {
    respond({ propose: () => ({ ok: false, body: { error: 'Out of credits' } }) })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    const propose = mockZoneProps['funnelsCreate'].propose as (brief: string) => Promise<string | null>
    expect(await propose('x')).toBe('Out of credits')
  })

  it('saves a new funnel and drops the site’s cached pages when recording switched on', async () => {
    respond({
      inventory: () => ({ ok: true, body: { inventory: { pages: ['/pricing'], forms: [{ id: 'f1', name: 'Contact' }], services: [], products: [], overlays: [] } } }),
      save: () => ({ ok: true, body: { funnelId: 'new', recordingChanged: true } }),
    })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    fireEvent.click(screen.getByText('New funnel'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/funnels/inventory', { hostId: 'h1' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mine' } })
    await waitFor(() => expect((screen.getByText('Save') as HTMLButtonElement).closest('button')?.disabled).toBe(false))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith({ user: { uid: 'u1' }, hostId: 'h1' }))
    const saved = mockFetch.mock.calls.find(([url]) => url === '/api/funnels/save')?.[1]
    expect(saved.funnel.name).toBe('Mine')
    expect(saved.funnel.steps).toHaveLength(2)
  })

  it('drafts a drop-off automation from a step, for a manager only', async () => {
    mockFunnels = [FUNNEL]
    respond({
      results: () => ({ ok: true, body: { result: RESULT } }),
      act: () => ({ ok: true, body: { automationId: 'a1', name: 'Follow up: Pricing to contact step 1', replayed: false } }),
    })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    fireEvent.click(await screen.findByLabelText('Act on the drop-off before step 2'))
    expect(screen.getByText(/People who reached step 1/)).toBeTruthy()
    fireEvent.click(screen.getByText('Draft the automation'))
    expect(await screen.findByText(/Drafted “Follow up: Pricing to contact step 1”, switched off/)).toBeTruthy()
    expect(screen.getByText('Open it on the Automation page').getAttribute('href')).toBe('/acme/hosts/shop/automation/actions')
    expect(mockRecordHref).toHaveBeenCalledWith('action', { orgSlug: 'acme', host: 'shop' }, 'a1')
    const sent = mockFetch.mock.calls.find(([url]) => url === '/api/funnels/act')?.[1]
    expect(sent).toEqual({ hostId: 'h1', funnelId: 'f1', step: 1, afterHours: 24, action: 'email' })
  })

  it('offers no drop-off action to a member who cannot manage funnels', async () => {
    mockRole = 'viewer'
    mockFunnels = [FUNNEL]
    respond({ results: () => ({ ok: true, body: { result: RESULT } }) })
    render(<FunnelsCard hostId="h1" orgId="o1" />)
    await screen.findByText(/30 of 200 visitors completed every step/)
    expect(screen.queryByText('Act on this drop-off')).toBeNull()
  })
})
