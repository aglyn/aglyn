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
 * so does the staff org page's bundle link card, whose QR is what staff show
 * at a booth: the two propose the same bundle. Staff change any of it from
 * there; a workspace with no build starts on the default bundle exactly as
 * before. The record is read only through the staff route, never from the
 * client.
 */

import type { ClientBuildIntent } from '@aglyn/aglyn/app-utils/client-build'
import type { AiTierId } from '@aglyn/aglyn'
import { planSellsAddon } from '@aglyn/aglyn/app-utils/bundle-intent'
import {
  AI_TIER_IDS,
  AI_TIERS,
  defaultAiTierForPlan,
  POS_REGISTER_ADDON_MONTHLY_USD,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
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
    if (url === '/api/admin/bundle-link') {
      return init?.method === 'POST'
        ? reply(200, { url: 'https://console.example.test/bundle/1', expiresAt: 1, intent: body })
        : reply(200, { domainsAvailable: true })
    }
    if (url === '/api/admin/client-build') return reply(mockBuildReply.status, mockBuildReply.body)
    throw new Error(`unexpected ${url}`)
  },
}))

import {
  bundleDraftBody,
  bundleDraftFromClientBuildIntent,
  DEFAULT_BUNDLE_DRAFT,
} from './staff-bundle-fields.component'
import {
  bundleDomainFromClientBuildIntent,
  EMPTY_BUNDLE_DOMAIN,
  StaffBundleLinkCard,
  useStaffClientBuild,
} from './staff-bundle-link.component'
import { StaffOrgOwnerHandoff } from './org-owner-handoff.component'

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

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } })
})

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

const value = (scope: HTMLElement, label: string) =>
  (within(scope).getByLabelText(label) as HTMLInputElement).value
const pressed = (scope: HTMLElement, name: string) =>
  within(scope).getByRole('button', { name }).getAttribute('aria-pressed')
const checked = (scope: HTMLElement, name: RegExp) =>
  (within(scope).getByRole('switch', { name }) as HTMLInputElement).checked
const combobox = (scope: HTMLElement, name: string) => within(scope).getByRole('combobox', { name }).textContent

/** What the last "Copy bundle link" asked the mint route for. */
async function mintedBy(scope: HTMLElement) {
  const before = mockPosts.length
  await act(async () => {
    fireEvent.click(within(scope).getByRole('button', { name: 'Copy bundle link' }))
  })
  const minted = mockPosts.slice(before).filter((post) => post.url === '/api/admin/bundle-link' && post.body['plan'])
  expect(minted).toHaveLength(1)
  return minted[0].body
}

describe('the staff hand-off dialog (AGL-3995)', () => {
  const open = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    })
    return screen.getByRole('dialog')
  }

  it('opens on the build: plan, add-ons, cadence, coupon and the domain with both prices', async () => {
    render(
      <StaffOrgOwnerHandoff orgId="org-1" orgName="Harbor Plumbing" sites={SITES} build={{ intent: REGISTER, hostId: 'host-1' }} />,
    )
    const dialog = await open()
    expect(combobox(dialog, 'Plan')).toBe('Pro')
    expect(pressed(dialog, 'Monthly')).toBe('true')
    expect(checked(dialog, /^Site Care/)).toBe(true)
    expect(checked(dialog, /^Aglyn AI/)).toBe(true)
    expect(value(dialog, 'Coupon code (optional)')).toBe('BOOTH25')
    expect(value(dialog, 'Domain name')).toBe('harborplumbing.com')
    expect(value(dialog, 'First year')).toBe('11.25')
    expect(value(dialog, 'Renews yearly at')).toBe('18.99')
    expect(combobox(dialog, 'For the site')).toBe('Harbor Plumbing')
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
    expect(combobox(dialog, 'Plan')).toBe('Starter')
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

describe('the staff org page’s bundle link card (AGL-3995)', () => {
  const card = () => screen.getByRole('button', { name: 'Copy bundle link' }).closest('.MuiCard-root') as HTMLElement
  const BUILD = { intent: REGISTER, hostId: 'host-1' }

  it('starts on the build’s bundle, as the hand-off dialog does', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={BUILD} />)
    await act(async () => undefined)
    const scope = card()
    expect(combobox(scope, 'Plan')).toBe('Pro')
    expect(pressed(scope, 'Monthly')).toBe('true')
    expect(checked(scope, /^Site Care/)).toBe(true)
    expect(checked(scope, /^Aglyn AI/)).toBe(true)
    expect(value(scope, 'Coupon code (optional)')).toBe('BOOTH25')
    expect(value(scope, 'Domain name')).toBe('harborplumbing.com')
    expect(value(scope, 'First year')).toBe('11.25')
    expect(value(scope, 'Renews yearly at')).toBe('18.99')
    expect(combobox(scope, 'For the site')).toBe('Harbor Plumbing')
  })

  it('the QR the card shows at the booth and the link the hand-off sends propose the same bundle', async () => {
    const view = render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={BUILD} />)
    await act(async () => undefined)
    const fromCard = await mintedBy(card())
    view.unmount()
    render(<StaffOrgOwnerHandoff orgId="org-1" sites={SITES} build={BUILD} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    })
    const fromDialog = await mintedBy(screen.getByRole('dialog'))
    expect(fromCard).toEqual(fromDialog)
    expect(fromCard).toEqual({
      orgId: 'org-1',
      plan: 'pro',
      addons: { siteCare: 1, aiAddon: 1 },
      interval: 'month',
      coupon: 'BOOTH25',
      // The tier the picker shows: the plan's default until staff pick one (AGL-4025).
      aiTier: defaultAiTierForPlan('pro'),
      domain: { name: 'harborplumbing.com', firstYearCents: 1125, renewalCents: 1899, hostId: 'host-1' },
    })
  })

  it('names the owner’s own domain as connected, not bought', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={{ intent: OWN, hostId: 'host-1' }} />)
    await act(async () => undefined)
    expect(value(card(), 'Domain name')).toBe('')
    expect(within(card()).getByText(/harborplumbing\.com is the owner’s own domain/)).toBeTruthy()
  })

  it('CONTROL: with no build it starts on the default bundle, as before', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    const scope = card()
    expect(combobox(scope, 'Plan')).toBe('Starter')
    expect(pressed(scope, 'Yearly')).toBe('true')
    expect(value(scope, 'Coupon code (optional)')).toBe('')
    expect(value(scope, 'Domain name')).toBe('')
    expect(within(scope).queryByText(/own domain/)).toBeNull()
  })

  it('puts the domain on the build’s site once the page’s sites arrive, and keeps what staff changed after', async () => {
    const view = render(<StaffBundleLinkCard orgId="org-1" sites={[]} build={BUILD} />)
    await act(async () => undefined)
    expect(within(card()).getByText('Choose the site the domain is for')).toBeTruthy()
    view.rerender(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={BUILD} />)
    expect(combobox(card(), 'For the site')).toBe('Harbor Plumbing')
    fireEvent.change(within(card()).getByLabelText('Coupon code (optional)'), { target: { value: 'DOOR10' } })
    // The page reads the same build again: an equal record changes nothing.
    view.rerender(<StaffBundleLinkCard orgId="org-1" sites={[...SITES]} build={{ ...BUILD, intent: { ...REGISTER } }} />)
    expect(value(card(), 'Coupon code (optional)')).toBe('DOOR10')
  })
})

describe('the Aglyn AI tier beside the staff bundle’s AI switch (AGL-4025)', () => {
  const card = () => screen.getByRole('button', { name: 'Copy bundle link' }).closest('.MuiCard-root') as HTMLElement
  const tierField = (scope: HTMLElement) => within(scope).queryByRole('combobox', { name: 'Aglyn AI tier' })
  const pickTier = async (scope: HTMLElement, tier: AiTierId) => {
    fireEvent.mouseDown(tierField(scope)!)
    const listbox = await screen.findByRole('listbox')
    const { label, monthlyUsd } = AI_TIERS[tier]
    fireEvent.click(within(listbox).getByRole('option', { name: new RegExp(`^${label} — \\$${monthlyUsd}/mo`) }))
  }

  it('shows no tier until Aglyn AI is on, then every tier with its price, on the plan’s default', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    expect(checked(card(), /^Aglyn AI/)).toBe(false)
    expect(tierField(card())).toBeNull()
    fireEvent.click(within(card()).getByRole('switch', { name: /^Aglyn AI/ }))
    const field = tierField(card())!
    const starter = AI_TIERS[defaultAiTierForPlan('starter')!]
    expect(field.textContent).toBe(`${starter.label} — $${starter.monthlyUsd}/mo`)
    fireEvent.mouseDown(field)
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(
      AI_TIER_IDS.map(
        (tier) =>
          `${AI_TIERS[tier].label} — $${AI_TIERS[tier].monthlyUsd}/mo` +
          `+${AI_TIERS[tier].credits.toLocaleString()} credits a month`,
      ),
    )
  })

  it('the tier staff pick is the one the link is minted with', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    fireEvent.click(within(card()).getByRole('switch', { name: /^Aglyn AI/ }))
    await pickTier(card(), 'plus')
    expect(tierField(card())!.textContent).toBe(`Plus — $${AI_TIERS.plus.monthlyUsd}/mo`)
    expect(await mintedBy(card())).toMatchObject({
      plan: 'starter',
      addons: { siteCare: 1, aiAddon: 1 },
      interval: 'year',
      aiTier: 'plus',
    })
    // The QR's summary names the tier the link carries.
    await act(async () => {
      fireEvent.click(within(card()).getByRole('button', { name: 'QR' }))
    })
    expect(screen.getByText('Starter with Aglyn AI Plus and Site Care, billed yearly')).toBeTruthy()
  })

  it('a tier with Aglyn AI switched off again goes nowhere', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    fireEvent.click(within(card()).getByRole('switch', { name: /^Aglyn AI/ }))
    await pickTier(card(), 'max')
    fireEvent.click(within(card()).getByRole('switch', { name: /^Aglyn AI/ }))
    expect(tierField(card())).toBeNull()
    const body = await mintedBy(card())
    expect(body).not.toHaveProperty('aiTier')
    expect(body['addons']).toEqual({ siteCare: 1 })
  })

  it('the hand-off proposes the tier staff pick', async () => {
    render(<StaffOrgOwnerHandoff orgId="org-1" sites={SITES} build={{ intent: REGISTER, hostId: 'host-1' }} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    })
    const dialog = screen.getByRole('dialog')
    await pickTier(dialog, 'ultra')
    expect(await mintedBy(dialog)).toMatchObject({ plan: 'pro', aiTier: 'ultra' })
    expect(bundleDraftBody({ ...DEFAULT_BUNDLE_DRAFT, addons: { aiAddon: 1 }, aiTier: 'ultra' })).toEqual({
      plan: 'starter',
      addons: { aiAddon: 1 },
      interval: 'year',
      aiTier: 'ultra',
    })
  })
})

describe('POS registers on the staff bundle (AGL-4025)', () => {
  const card = () => screen.getByRole('button', { name: 'Copy bundle link' }).closest('.MuiCard-root') as HTMLElement
  const registers = () => within(card()).getByLabelText('POS register') as HTMLInputElement

  it('show on Starter, disabled with the plan they need, rather than left off', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    expect(combobox(card(), 'Plan')).toBe('Starter')
    expect(registers().disabled).toBe(true)
    expect(within(card()).getByText('Needs Pro or higher')).toBeTruthy()
    expect((await mintedBy(card()))['addons']).toEqual({ siteCare: 1 })
  })

  it('on Pro they are priced, and the count staff enter is on the link', async () => {
    render(<StaffBundleLinkCard orgId="org-1" sites={SITES} build={null} />)
    await act(async () => undefined)
    fireEvent.mouseDown(within(card()).getByRole('combobox', { name: 'Plan' }))
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Pro' }))
    expect(registers().disabled).toBe(false)
    expect(within(card()).getByText(`$${POS_REGISTER_ADDON_MONTHLY_USD}/mo each`)).toBeTruthy()
    fireEvent.change(registers(), { target: { value: '2' } })
    expect(await mintedBy(card())).toMatchObject({ plan: 'pro', addons: { siteCare: 1, posRegisters: 2 } })
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
