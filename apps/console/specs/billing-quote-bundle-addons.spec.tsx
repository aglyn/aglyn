/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

/**
 * The quote card prices the bundle a link or a proposal chose (AGL-3955).
 *
 * The add-ons arrive preselected as switches and are quoted on the same
 * invoice as the plan, so the total shown is the total charged. An add-on
 * the plan does not sell is never quoted. A coupon the link carried is tried
 * on the first quote, and one Stripe will not resolve is left off with a
 * one-line notice rather than an error, while a refusal that is not about
 * the code is never blamed on it.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import {
  addonUnitUsd,
  bundleListPriceCents,
  type AddonKind,
  type BundleAddons,
} from '@aglyn/aglyn/app-utils/bundle-intent'
import { AI_TIERS, defaultAiTierForPlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AiTierId } from '@aglyn/aglyn'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))
const mockUser = { uid: 'u-1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/aglyn', () => ({
  parseLockdownRefusal: () => null,
}))
jest.mock('../components/lockdown-notice.component', () => ({
  __esModule: true,
  default: () => null,
}))

import BillingPlanQuoteComponent from '../components/billing/billing-plan-quote.component'

const QUOTE = {
  preview: {
    subtotalCents: 5880,
    discountCents: 0,
    taxCents: 0,
    totalCents: 5880,
    currency: 'usd',
    taxComplete: true,
    taxReason: 'standard_rated',
  },
  customerTaxExempt: 'none',
  hasTaxId: true,
  promotionCodeApplied: null,
}

/** Every request body the card posted, in order. */
let posted: Array<Record<string, any>>
/** Answers served in order; the last one repeats. */
let answers: Array<{ status: number; body: unknown }>

function answer(...next: Array<{ status: number; body: unknown }>) {
  answers = next
}

beforeEach(() => {
  posted = []
  answer({ status: 200, body: QUOTE })
  mockEnqueue.mockClear()
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  }) as never
})

afterEach(() => jest.restoreAllMocks())

function mount(props: {
  plan?: string
  interval?: 'month' | 'year'
  addons?: BundleAddons
  offered?: readonly AddonKind[]
  onIntervalChange?: (interval: 'month' | 'year') => void
  onAddonsChange?: (next: BundleAddons) => void
  aiTier?: AiTierId
  initialCoupon?: string
  linkNotice?: string
  onAppliedCodeChange?: (code: string) => void
  onQuoted?: (preview: { totalCents: number; currency: string } | null) => void
}) {
  const view = (addons?: BundleAddons) => (
    <BillingPlanQuoteComponent
      orgId="org-1"
      plan={props.plan ?? 'starter'}
      interval={props.interval ?? 'month'}
      canManage
      appliedCode=""
      onAppliedCodeChange={props.onAppliedCodeChange ?? (() => undefined)}
      addons={addons}
      offered={props.offered}
      onIntervalChange={props.onIntervalChange}
      onAddonsChange={props.onAddonsChange}
      aiTier={props.aiTier}
      initialCoupon={props.initialCoupon}
      linkNotice={props.linkNotice}
      onQuoted={props.onQuoted}
    />
  )
  const rendered = render(view(props.addons))
  return { ...rendered, rerenderWith: (addons?: BundleAddons) => rendered.rerender(view(addons)) }
}

describe('the bundle’s add-ons on the quote (AGL-3955)', () => {
  it('arrive switched on, and are quoted on the same invoice as the plan', async () => {
    const quoted: unknown[] = []
    mount({
      addons: { siteCare: 1 },
      onAddonsChange: () => undefined,
      onQuoted: (preview) => void quoted.push(preview),
    })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted[0]).toMatchObject({ action: 'preview', plan: 'starter', addons: { siteCare: 1 } })
    const siteCare = screen.getByLabelText(/Site Care/) as HTMLInputElement
    expect(siteCare.checked).toBe(true)
    // Only what the bundle named is offered (AGL-4026): no Event Calendar row.
    expect(screen.queryByLabelText(/Event calendar/i)).toBeNull()
    // The page's total is cleared while a quote is on its way, then set.
    expect(quoted).toEqual([null, { totalCents: 5880, currency: 'usd' }])
  })

  it('turning one off hands the page the bundle without it, and re-quotes', async () => {
    const changes: BundleAddons[] = []
    const { rerenderWith } = mount({
      addons: { siteCare: 1 },
      onAddonsChange: (next) => void changes.push(next),
    })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    fireEvent.click(screen.getByLabelText(/Site Care/))
    expect(changes).toEqual([{}])
    rerenderWith({})
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]['addons']).toBeUndefined()
  })

  it('never quotes an add-on the plan does not sell', async () => {
    mount({ addons: { posRegisters: 1, siteCare: 1 }, onAddonsChange: () => undefined })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted[0]['addons']).toEqual({ siteCare: 1 })
    expect(screen.queryByLabelText(/POS register/)).toBeNull()
  })

  it('preselects the Aglyn AI tier the link named, worded, priced and quoted as that tier (AGL-3965)', async () => {
    // `addons=siteCare,ai:studio` on a Starter link: Studio, not Starter's Spark.
    mount({ addons: { siteCare: 1, aiAddon: 1 }, aiTier: 'studio', onAddonsChange: () => undefined })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted[0]).toMatchObject({ addons: { siteCare: 1, aiAddon: 1 }, aiTier: 'studio' })
    const ai = screen.getByLabelText(/AI Studio/) as HTMLInputElement
    expect(ai.checked).toBe(true)
    expect(screen.getByText(/\$299\/mo/)).toBeTruthy()
  })

  it('CONTROL: the tier rides only with the AI add-on', async () => {
    mount({ addons: { siteCare: 1 }, aiTier: 'studio', onAddonsChange: () => undefined })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted[0]['aiTier']).toBeUndefined()
  })

  it('shows the page’s one-line notice for what the link left off', async () => {
    mount({ linkNotice: 'Banana is not something Billing sells, so it was left off.' })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(screen.getByText(/Banana is not something Billing sells/)).toBeTruthy()
  })
})

describe('the owner can change the Aglyn AI tier the link chose (AGL-4025)', () => {
  /** The page's part: it holds the add-ons and the tier, as Billing does. */
  function Billing(props: { addons: BundleAddons; aiTier?: AiTierId; interval?: 'month' | 'year' }) {
    const [addons, setAddons] = useState<BundleAddons>(props.addons)
    const [aiTier, setAiTier] = useState<AiTierId | null>(props.aiTier ?? null)
    return (
      <BillingPlanQuoteComponent
        orgId="org-1"
        plan="starter"
        interval={props.interval ?? 'month'}
        canManage
        appliedCode=""
        onAppliedCodeChange={() => undefined}
        addons={addons}
        onAddonsChange={setAddons}
        aiTier={aiTier}
        onAiTierChange={setAiTier}
      />
    )
  }
  const tierField = () => screen.queryByRole('combobox', { name: 'Aglyn AI tier' })

  it('opens on the link’s tier beside the switch, and a new tier re-quotes as that tier', async () => {
    render(<Billing addons={{ siteCare: 1, aiAddon: 1 }} aiTier="boost" />)
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(tierField()!.textContent).toBe(`Boost — $${AI_TIERS.boost.monthlyUsd}/mo`)
    expect(posted[0]).toMatchObject({ addons: { siteCare: 1, aiAddon: 1 }, aiTier: 'boost' })
    fireEvent.mouseDown(tierField()!)
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: /^Max — / }),
    )
    await waitFor(() => expect(posted.at(-1)).toMatchObject({ aiTier: 'max' }))
    expect(posted.at(-1)).toMatchObject({ addons: { siteCare: 1, aiAddon: 1 } })
    expect(tierField()!.textContent).toBe(`Max — $${AI_TIERS.max.monthlyUsd}/mo`)
  })

  it('a link with no tier opens on the plan’s default, and yearly billing prices it yearly', async () => {
    render(<Billing addons={{ aiAddon: 1 }} interval="year" />)
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    const tier = AI_TIERS[defaultAiTierForPlan('starter')!]
    expect(tierField()!.textContent).toBe(`${tier.label} — $${tier.yearlyUsd}/yr`)
  })

  it('turning Aglyn AI off removes it and its tier from the quote', async () => {
    render(<Billing addons={{ siteCare: 1, aiAddon: 1 }} aiTier="plus" />)
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: /^Aglyn AI/ }))
    await waitFor(() => expect(posted.at(-1)?.['addons']).toEqual({ siteCare: 1 }))
    expect(posted.at(-1)?.['aiTier']).toBeUndefined()
    expect(tierField()).toBeNull()
  })

  it('CONTROL: without onAiTierChange the switch names the tier and no picker shows', async () => {
    mount({ addons: { aiAddon: 1 }, aiTier: 'studio', onAddonsChange: () => undefined })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(tierField()).toBeNull()
    expect(screen.getByText(/Aglyn AI Studio/)).toBeTruthy()
  })
})

describe('the card offers what the link named, with counts, a cadence and a total (AGL-4026)', () => {
  const NO_ADDRESS = { status: 200, body: { needsBillingDetails: true } }

  it('offers only the add-ons the link named, and keeps a row once it is switched off', async () => {
    answer(NO_ADDRESS)
    mount({ addons: {}, offered: ['siteCare'], onAddonsChange: () => undefined })
    await waitFor(() => expect(posted).toHaveLength(1))
    expect((screen.getByLabelText(/Site Care/) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText(/Event calendar/i)).toBeNull()
    expect(screen.queryByLabelText(/Aglyn AI/)).toBeNull()
  })

  it('shows each counted add-on the link named as a count the owner can change', async () => {
    answer(NO_ADDRESS)
    const changes: BundleAddons[] = []
    mount({
      plan: 'pro',
      addons: { managers: 2, posRegisters: 1 },
      offered: ['managers', 'posRegisters'],
      onAddonsChange: (next) => void changes.push(next),
    })
    await waitFor(() => expect(posted).toHaveLength(1))
    const seats = screen.getByLabelText('Extra manager seat') as HTMLInputElement
    const registers = screen.getByLabelText('POS register') as HTMLInputElement
    expect(seats.value).toBe('2')
    expect(registers.value).toBe('1')
    expect(screen.getByText(`$${addonUnitUsd('posRegisters', 'pro')}/mo each`)).toBeTruthy()
    fireEvent.change(seats, { target: { value: '5' } })
    fireEvent.change(registers, { target: { value: '0' } })
    expect(changes).toEqual([{ managers: 5, posRegisters: 1 }, { managers: 2 }])
    // Counted add-ons the link did not name stay off the card.
    expect(screen.queryByLabelText('Extra site')).toBeNull()
    expect(screen.queryByLabelText('Extra dataset')).toBeNull()
  })

  it('the cadence switches where the total is', async () => {
    answer(NO_ADDRESS)
    const chosen: string[] = []
    mount({ addons: {}, onIntervalChange: (interval) => void chosen.push(interval) })
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }))
    expect(chosen).toEqual(['year'])
  })

  it('with no billing address, shows the total before tax and moves it with every change', async () => {
    answer(NO_ADDRESS)
    const bundle = { siteCare: 1, aiAddon: 1, managers: 2 }
    const view = mount({ interval: 'year', addons: bundle, offered: ['siteCare', 'aiAddon', 'managers'], aiTier: 'plus', onAddonsChange: () => undefined })
    await waitFor(() => expect(posted).toHaveLength(1))
    const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/yr`
    const before = bundleListPriceCents({ plan: 'starter', interval: 'year', addons: bundle, aiTier: 'plus' })
    expect(screen.getByText('Total before tax')).toBeTruthy()
    expect(screen.getByText(usd(before))).toBeTruthy()
    expect(screen.getByText(/Add your billing address to see the total with tax/)).toBeTruthy()
    expect(screen.queryByText(/Select a plan/)).toBeNull()
    view.rerenderWith({ ...bundle, managers: 3 })
    const after = bundleListPriceCents({ plan: 'starter', interval: 'year', addons: { ...bundle, managers: 3 }, aiTier: 'plus' })
    expect(after).toBeGreaterThan(before)
    expect(screen.getByText(usd(after))).toBeTruthy()
  })

  it('a quote that fails still shows the bundle and its total before tax', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline')
    }) as never
    mount({ addons: { siteCare: 1 }, offered: ['siteCare'], onAddonsChange: () => undefined })
    await waitFor(() => expect(screen.getByText(/could not get the total with tax/)).toBeTruthy())
    expect(screen.getByLabelText(/Site Care/)).toBeTruthy()
    expect(screen.getByText('Total before tax')).toBeTruthy()
  })

  it('only the newest quote lands when an older one answers late', async () => {
    const resolvers: Array<() => void> = []
    global.fetch = jest.fn((_url: unknown, init: any) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      const body = posted.length === 1 ? { ...QUOTE, preview: { ...QUOTE.preview, totalCents: 1111 } } : QUOTE
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ ok: true, status: 200, json: async () => body }))
      })
    }) as never
    const quoted: unknown[] = []
    const view = mount({ addons: { siteCare: 1 }, offered: ['siteCare'], onAddonsChange: () => undefined, onQuoted: (q) => void quoted.push(q) })
    await waitFor(() => expect(posted).toHaveLength(1))
    view.rerenderWith({})
    await waitFor(() => expect(posted).toHaveLength(2))
    resolvers[1]()
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    resolvers[0]()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(quoted.filter(Boolean)).toEqual([{ totalCents: QUOTE.preview.totalCents, currency: 'usd' }])
  })
})

describe('the link’s coupon (AGL-3955)', () => {
  it('is tried on the first quote', async () => {
    answer({ status: 200, body: { ...QUOTE, promotionCodeApplied: 'BOOTH25' } })
    const codes: string[] = []
    mount({ initialCoupon: 'BOOTH25', onAppliedCodeChange: (code) => void codes.push(code) })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted[0]['promotionCode']).toBe('BOOTH25')
    expect(codes).toEqual(['BOOTH25'])
  })

  it('one Stripe will not resolve is left off with a notice, and the quote goes on without it', async () => {
    answer(
      { status: 400, body: { error: 'That code is not recognized.' } },
      { status: 200, body: QUOTE },
    )
    const codes: string[] = []
    mount({ initialCoupon: 'EXPIRED1', onAppliedCodeChange: (code) => void codes.push(code) })
    await waitFor(() => expect(screen.getByText('Subtotal')).toBeTruthy())
    expect(posted.map((body) => body['promotionCode'])).toEqual(['EXPIRED1', ''])
    expect(screen.getByText(/The code EXPIRED1 from your link is not valid/)).toBeTruthy()
    expect(codes).toContain('')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('CONTROL: a refusal that is not about the code is not blamed on it', async () => {
    answer({ status: 400, body: { error: 'This plan sells at most 3 of Extra manager seat.', code: 'addon_over_max' } })
    mount({ initialCoupon: 'BOOTH25' })
    await waitFor(() => expect(posted).toHaveLength(1))
    // Give a retry the chance to happen if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(posted).toHaveLength(1)
    expect(screen.queryByText(/from your link is not valid/)).toBeNull()
  })
})
