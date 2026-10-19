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
 * AGL-3995 — the hand-off opens on the client build's bundle.
 *
 * A workspace staff built for a client (AGL-3958) left an intent for its
 * hand-off: the plan, the add-ons, the cadence, a coupon, and the domain the
 * owner picked to register or already has. The staff dialog opens on it, and
 * staff change any of it from there; a workspace with no build opens on the
 * default bundle exactly as before. The record is read only through the
 * staff route, never from the client.
 */

import type { ClientBuildIntent } from '@aglyn/aglyn/app-utils/client-build'
import { planSellsAddon } from '@aglyn/aglyn/app-utils/bundle-intent'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'

const mockSnackbar = jest.fn()
const mockPosts: Array<{ url: string; body: Record<string, unknown> }> = []
let mockBuildReply: { status: number; body: unknown } = { status: 200, body: { record: null } }

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

const mockUserObject = { uid: 'staff-1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUserObject }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    mockPosts.push({ url, body })
    if (url === '/api/admin/bundle-link') return reply(200, { domainsAvailable: true })
    if (url === '/api/admin/client-build') return reply(mockBuildReply.status, mockBuildReply.body)
    throw new Error(`unexpected ${url}`)
  },
}))

import { bundleDraftFromClientBuildIntent, DEFAULT_BUNDLE_DRAFT } from './staff-bundle-fields.component'
import { bundleDomainFromClientBuildIntent, EMPTY_BUNDLE_DOMAIN } from './staff-bundle-link.component'
import { StaffOrgOwnerHandoff, useStaffClientBuild } from './org-owner-handoff.component'

const REGISTER: ClientBuildIntent = {
  plan: 'pro',
  addons: ['siteCare', 'aiAddon'],
  interval: 'month',
  coupon: 'BOOTH25',
  domain: { name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
}
const OWN: ClientBuildIntent = {
  plan: 'starter',
  addons: ['siteCare'],
  interval: 'month',
  existingDomain: 'harborplumbing.com',
}
/** The site stays on its free address: the build names no domain. */
const FREE: ClientBuildIntent = { plan: 'starter', addons: ['siteCare'], interval: 'month' }
const SITES = [
  { hostId: 'host-1', name: 'Harbor Plumbing' },
  { hostId: 'host-2', name: 'Harbor Rentals' },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockPosts.length = 0
  mockBuildReply = { status: 200, body: { record: null } }
})

describe('the bundle a client build leaves its hand-off (AGL-3995)', () => {
  it('a name to register carries both prices, for the site the build made', () => {
    expect(bundleDomainFromClientBuildIntent(REGISTER, 'host-1')).toEqual({
      name: 'harborplumbing.com',
      firstYear: '11.25',
      renewal: '18.99',
      hostId: 'host-1',
    })
    // A site staff cannot pick here leaves the choice to them.
    expect(bundleDomainFromClientBuildIntent(REGISTER, null).hostId).toBe('')
  })

  it('a domain the owner already has, or none at all, puts nothing on the link', () => {
    expect(bundleDomainFromClientBuildIntent(OWN, 'host-1')).toEqual(EMPTY_BUNDLE_DOMAIN)
    expect(bundleDomainFromClientBuildIntent(FREE, 'host-1')).toEqual(EMPTY_BUNDLE_DOMAIN)
    expect(bundleDomainFromClientBuildIntent(null)).toEqual(EMPTY_BUNDLE_DOMAIN)
  })

  it('the plan, add-ons, cadence and coupon become the draft the picker shows', () => {
    expect(bundleDraftFromClientBuildIntent(REGISTER)).toEqual({
      plan: 'pro',
      addons: { siteCare: 1, aiAddon: 1 },
      interval: 'month',
      coupon: 'BOOTH25',
    })
  })

  it('leaves off what the plan does not sell and a coupon that is not a code', () => {
    // Premise: a Starter workspace has no point of sale to add registers to.
    expect(planSellsAddon('posRegisters', 'starter')).toBe(false)
    expect(
      bundleDraftFromClientBuildIntent({
        plan: 'starter',
        addons: ['siteCare', 'posRegisters'],
        interval: 'year',
        coupon: 'not a code!',
      }),
    ).toEqual({ plan: 'starter', addons: { siteCare: 1 }, interval: 'year', coupon: '' })
  })
})

describe('the staff hand-off dialog (AGL-3995)', () => {
  const open = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    })
    return screen.getByRole('dialog')
  }
  const value = (dialog: HTMLElement, label: string) =>
    (within(dialog).getByLabelText(label) as HTMLInputElement).value
  const pressed = (dialog: HTMLElement, name: string) =>
    within(dialog).getByRole('button', { name }).getAttribute('aria-pressed')
  const checked = (dialog: HTMLElement, name: RegExp) =>
    (within(dialog).getByRole('switch', { name }) as HTMLInputElement).checked

  it('opens on the build: plan, add-ons, cadence, coupon and the domain with both prices', async () => {
    render(
      <StaffOrgOwnerHandoff orgId="org-1" orgName="Harbor Plumbing" sites={SITES} build={{ intent: REGISTER, hostId: 'host-1' }} />,
    )
    const dialog = await open()
    expect(within(dialog).getByRole('combobox', { name: 'Plan' }).textContent).toBe('Pro')
    expect(pressed(dialog, 'Monthly')).toBe('true')
    expect(checked(dialog, /^Site Care/)).toBe(true)
    expect(checked(dialog, /^Aglyn AI/)).toBe(true)
    expect(value(dialog, 'Coupon code (optional)')).toBe('BOOTH25')
    expect(value(dialog, 'Domain name')).toBe('harborplumbing.com')
    expect(value(dialog, 'First year')).toBe('11.25')
    expect(value(dialog, 'Renews yearly at')).toBe('18.99')
    expect(within(dialog).getByRole('combobox', { name: 'For the site' }).textContent).toBe('Harbor Plumbing')
  })

  it('says the owner’s own domain is connected, not bought, and puts none on the link', async () => {
    render(<StaffOrgOwnerHandoff orgId="org-1" sites={SITES} build={{ intent: OWN, hostId: 'host-1' }} />)
    const dialog = await open()
    expect(value(dialog, 'Domain name')).toBe('')
    expect(within(dialog).getByText(/harborplumbing\.com is the owner’s own domain/)).toBeTruthy()
    expect(pressed(dialog, 'Monthly')).toBe('true')
  })

  it('CONTROL: with no build it opens on the default bundle, as before', async () => {
    render(<StaffOrgOwnerHandoff orgId="org-1" sites={SITES} build={null} />)
    const dialog = await open()
    expect(DEFAULT_BUNDLE_DRAFT).toMatchObject({ plan: 'starter', interval: 'year' })
    expect(within(dialog).getByRole('combobox', { name: 'Plan' }).textContent).toBe('Starter')
    expect(pressed(dialog, 'Yearly')).toBe('true')
    expect(checked(dialog, /^Site Care/)).toBe(true)
    expect(value(dialog, 'Coupon code (optional)')).toBe('')
    expect(value(dialog, 'Domain name')).toBe('')
    expect(within(dialog).queryByText(/own domain/)).toBeNull()
  })

  it('staff change any of it, and what they changed survives closing and reopening', async () => {
    render(<StaffOrgOwnerHandoff orgId="org-1" sites={SITES} build={{ intent: REGISTER, hostId: 'host-1' }} />)
    let dialog = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yearly' }))
    fireEvent.change(within(dialog).getByLabelText('Coupon code (optional)'), { target: { value: 'DOOR10' } })
    fireEvent.change(within(dialog).getByLabelText('Domain name'), { target: { value: 'harbor.plumbing' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    dialog = await open()
    expect(pressed(dialog, 'Yearly')).toBe('true')
    expect(value(dialog, 'Coupon code (optional)')).toBe('DOOR10')
    expect(value(dialog, 'Domain name')).toBe('harbor.plumbing')
  })

  it('a build for a site that is not offered here leaves the site for staff to choose', async () => {
    render(
      <StaffOrgOwnerHandoff
        orgId="org-1"
        sites={[SITES[1]]}
        build={{ intent: REGISTER, hostId: 'host-1' }}
      />,
    )
    const dialog = await open()
    expect(value(dialog, 'Domain name')).toBe('harborplumbing.com')
    expect(within(dialog).getByText('Choose the site the domain is for')).toBeTruthy()
  })
})

describe('reading the build on the staff pages (AGL-3995)', () => {
  it('asks the staff client-build route for the workspace’s record, and keeps its intent and site', async () => {
    mockBuildReply = {
      status: 200,
      body: { record: { intent: REGISTER, hostId: 'host-1', intake: {} }, capabilities: {} },
    }
    const { result } = renderHook(() => useStaffClientBuild('org-1'))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual({ intent: REGISTER, hostId: 'host-1' })
    expect(mockPosts).toEqual([{ url: '/api/admin/client-build', body: { orgId: 'org-1', action: 'get' } }])
  })

  it('a workspace with no build, a refusal or a record it cannot read is no build', async () => {
    for (const answer of [
      { status: 200, body: { record: null } },
      { status: 403, body: { error: 'Staff only' } },
      { status: 200, body: { record: { intent: { plan: 'platinum' } } } },
    ]) {
      mockBuildReply = answer
      mockPosts.length = 0
      const { result } = renderHook(() => useStaffClientBuild('org-1'))
      await waitFor(() => expect(mockPosts).toHaveLength(1))
      await act(async () => undefined)
      expect(result.current).toBeNull()
    }
  })

  it('reads nothing until the workspace is known', async () => {
    renderHook(() => useStaffClientBuild(''))
    await act(async () => undefined)
    expect(mockPosts).toHaveLength(0)
  })
})
