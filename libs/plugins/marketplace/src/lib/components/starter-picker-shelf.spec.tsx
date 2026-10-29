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
import type { ConsoleHostStarterPickerZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'

/**
 * "Choose your starter", the marketplace's half (AGL-4049).
 *
 * The shelf is drawn before a site exists and creates nothing. What has to
 * hold: nothing is chosen for the person when it opens (a pick is theirs,
 * every time); a click hands the dialog the starter picked; `ready` says
 * truthfully whether a picker is on screen, so a workspace without starters
 * gets the dialog's own choice instead of an empty box; and every card says
 * its price — "Free" included — and whether it is Aglyn's or an AI starter.
 */

const USER = { uid: 'member-1', getIdToken: async () => 'token' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: USER }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  readGaClientId: async () => null,
}))

import { starterPurchaseNavigation } from '../hooks/use-starter-purchase'
import { StarterPickerShelf } from './starter-picker-shelf.component'

const OFFICIAL = {
  listingId: 'fp-starter-restaurant-base',
  displayName: 'Corner bistro',
  description: 'A starter',
  authorName: 'Aglyn',
  official: true,
  priceUsd: 0,
  previewImageUrl: 'https://console.example/_static/starter/styles/restaurant.webp',
  facets: { kind: 'restaurant', base: 'starter', fonts: 'jakarta', pages: 4, mode: 'base' },
  category: 'Restaurant & café',
}
const PAID = {
  listingId: 'northwind-studio',
  displayName: 'Studio North',
  description: '',
  authorName: 'Northwind',
  official: false,
  priceUsd: 12,
  previewImageUrl: null,
  facets: { kind: null, base: null, fonts: null, pages: 1, mode: 'base' },
  category: null,
}
const AI = {
  ...OFFICIAL,
  listingId: 'fp-starter-restaurant-ai',
  displayName: 'Corner bistro, written for you',
  facets: { ...OFFICIAL.facets, mode: 'ai' },
}

const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })

const answering = (rows: unknown[]) =>
  mockFetch.mockImplementation(() => respond(200, { rows, labels: { base: {}, fonts: {} } }))

function shelf(over: Partial<ConsoleHostStarterPickerZoneProps> = {}) {
  const props: ConsoleHostStarterPickerZoneProps = {
    orgId: 'org-1',
    orgSlug: 'acme',
    mode: 'base',
    search: '',
    filter: {},
    onPick: jest.fn(),
    ready: jest.fn(),
    ...over,
  }
  return { props, ...render(<StarterPickerShelf {...props} />) }
}

beforeEach(() => {
  mockFetch.mockReset()
  answering([OFFICIAL, PAID])
})

describe('nothing is chosen for the person', () => {
  it('opens with every card unpicked and calls onPick for none of them', async () => {
    const { props } = shelf()
    const cards = await screen.findAllByRole('radio')
    expect(cards).toHaveLength(2)
    for (const card of cards) expect(card.getAttribute('aria-checked')).toBe('false')
    expect(document.querySelectorAll('[data-option-card-check]')).toHaveLength(0)
    expect(props.onPick).not.toHaveBeenCalled()
  })

  it('hands the dialog the starter clicked, and marks that card picked', async () => {
    const { props } = shelf()
    const card = await screen.findByRole('radio', { name: /^Studio North/ })
    fireEvent.click(card)
    expect(props.onPick).toHaveBeenCalledTimes(1)
    expect(props.onPick).toHaveBeenCalledWith(PAID)
    expect(card.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^Corner bistro/ }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })
})

describe('ready says whether a picker is on screen', () => {
  it('answers true once the starters draw, and only once', async () => {
    const { props } = shelf()
    await screen.findAllByRole('radio')
    await waitFor(() => expect(props.ready).toHaveBeenCalledWith(true))
    expect(props.ready).toHaveBeenCalledTimes(1)
  })

  it('answers nothing while the first answer is out, and shows it is loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => undefined))
    const { props } = shelf()
    expect(screen.getByLabelText('Loading starters')).toBeTruthy()
    expect(props.ready).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'Site starters are not available for this workspace yet'],
    [403, 'Your role does not include "Create sites" — ask an organization admin'],
    [503, 'Starters are unavailable right now. Try again in a moment.'],
  ])('answers false and draws nothing on a %i', async (status, error) => {
    mockFetch.mockImplementation(() => respond(status, { error }))
    const { props, container } = shelf()
    await waitFor(() => expect(props.ready).toHaveBeenCalledWith(false))
    expect(props.ready).not.toHaveBeenCalledWith(true)
    expect(container.textContent).toBe('')
  })

  it('answers false when there are no starters at all and nothing was asked', async () => {
    answering([])
    const { props, container } = shelf()
    await waitFor(() => expect(props.ready).toHaveBeenCalledWith(false))
    expect(container.textContent).toBe('')
  })

  it('answers true for a search that found nothing, and says to try fewer words', async () => {
    answering([])
    const { props } = shelf({ search: 'zzz quantum bakery' })
    await waitFor(() => expect(props.ready).toHaveBeenCalledWith(true))
    expect(screen.getByText('No starters match — try fewer words')).toBeTruthy()
  })

  it('keeps the picker once shown, and says a later failure with a way to ask again', async () => {
    const { props, rerender } = shelf()
    await screen.findAllByRole('radio')
    mockFetch.mockImplementation(() => respond(500, { error: 'Starters could not be loaded' }))
    rerender(<StarterPickerShelf {...props} mode="ai" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Starters could not be loaded')
    expect(props.ready).not.toHaveBeenCalledWith(false)
    answering([AI])
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('radio', { name: /written for you/ })).toBeTruthy()
  })
})

describe('what each card says', () => {
  it('names the starter, who made it, its price, Aglyn’s mark, its kind and its pages', async () => {
    shelf()
    const card = await screen.findByRole('radio', {
      name: 'Corner bistro: By Aglyn (Free, Aglyn, Restaurant & café, 4 pages)',
    })
    for (const chip of ['Free', 'Aglyn', 'Restaurant & café', '4 pages']) {
      expect(within(card).getByText(chip)).toBeTruthy()
    }
  })

  it('prices a paid starter in dollars, and gives a card with no picture an icon instead', async () => {
    shelf()
    const card = await screen.findByRole('radio', { name: 'Studio North: By Northwind ($12, 1 page)' })
    expect(within(card).getByText('$12')).toBeTruthy()
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('svg')).not.toBeNull()
  })

  it('shows the starter’s picture, described', async () => {
    shelf()
    const card = await screen.findByRole('radio', { name: /^Corner bistro/ })
    const picture = card.querySelector('img')
    expect(picture?.getAttribute('src')).toBe(OFFICIAL.previewImageUrl)
    expect(picture?.getAttribute('alt')).toBe('A preview of Corner bistro')
  })

  it('marks an AI starter "AI"', async () => {
    answering([AI])
    shelf({ mode: 'ai' })
    const card = await screen.findByRole('radio', { name: /written for you/ })
    expect(within(card).getByText('AI')).toBeTruthy()
    expect(mockFetch.mock.calls[0][1]).toContain('mode=ai')
  })
})

describe('a pick with a price, and the way back to it (AGL-4049 lane 3)', () => {
  const assign = jest.spyOn(starterPurchaseNavigation, 'assign').mockImplementation(() => undefined)
  /** Answers the search with `rows`, and the checkout with `checkout`. */
  const answeringWith = (rows: unknown[], checkout: { status: number; body: unknown }) =>
    mockFetch.mockImplementation((_user: unknown, url: string) =>
      url === '/api/marketplace/checkout'
        ? respond(checkout.status, checkout.body)
        : respond(200, { rows, labels: { base: {}, fonts: {} } }),
    )
  const checkoutCalls = () => mockFetch.mock.calls.filter(([, url]) => url === '/api/marketplace/checkout')

  beforeEach(() => assign.mockClear())

  it('says the price of a paid pick, and opens its payment with Create site as the way back', async () => {
    answeringWith([OFFICIAL, PAID], { status: 200, body: { url: 'https://checkout.stripe.test/c/1' } })
    const { props } = shelf()
    // Nothing to buy until a priced starter is picked.
    await screen.findAllByRole('radio')
    expect(screen.queryByRole('button', { name: 'Buy and continue' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /^Studio North/ }))
    expect(props.onPick).toHaveBeenCalledWith(PAID)
    const note = document.querySelector('[data-starter-buy="northwind-studio"]') as HTMLElement
    expect(note.textContent).toContain('Studio North costs $12.')
    fireEvent.click(within(note).getByRole('button', { name: 'Buy and continue' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c/1'))
    const [, , init] = checkoutCalls()[0] as [unknown, string, { body: string; headers: Record<string, string> }]
    expect(JSON.parse(init.body)).toEqual({ listingId: 'northwind-studio', orgId: 'org-1', return: 'create-site' })
    expect(init.headers['Idempotency-Key']).toBeTruthy()
  })

  it('says a free pick needs nothing bought', async () => {
    shelf()
    fireEvent.click(await screen.findByRole('radio', { name: /^Corner bistro/ }))
    expect(screen.queryByRole('button', { name: 'Buy and continue' })).toBeNull()
    expect(screen.queryByText(/You own this starter/)).toBeNull()
  })

  it('says "You own this starter" for a priced one the workspace owns, with nothing to buy', async () => {
    answering([OFFICIAL, { ...PAID, owned: true }])
    shelf()
    fireEvent.click(await screen.findByRole('radio', { name: /^Studio North/ }))
    expect(screen.getByText(/You own this starter/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Buy and continue' })).toBeNull()
  })

  it('learns from the payment that the workspace owns it already, and tells the dialog', async () => {
    answeringWith([OFFICIAL, PAID], { status: 409, body: { code: 'already_purchased', error: 'owned' } })
    const { props } = shelf()
    fireEvent.click(await screen.findByRole('radio', { name: /^Studio North/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Buy and continue' }))
    await screen.findByText(/You own this starter/)
    expect(props.onPick).toHaveBeenLastCalledWith({ ...PAID, owned: true })
    expect(assign).not.toHaveBeenCalled()
  })

  it('says why a payment did not open, and stays on the pick', async () => {
    answeringWith([OFFICIAL, PAID], { status: 409, body: { error: 'The publisher has not enabled payouts yet' } })
    shelf()
    fireEvent.click(await screen.findByRole('radio', { name: /^Studio North/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Buy and continue' }))
    expect(await screen.findByText('The publisher has not enabled payouts yet')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Studio North/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('shows the pick the dialog restored as chosen, asks for it by name, and hands it back once', async () => {
    const { props } = shelf({ selected: { listingId: 'northwind-studio', owned: true } })
    const card = await screen.findByRole('radio', { name: /^Studio North/ })
    expect(card.getAttribute('aria-checked')).toBe('true')
    expect(String(mockFetch.mock.calls[0][1])).toContain('include=northwind-studio')
    await waitFor(() => expect(props.onPick).toHaveBeenCalledWith({ ...PAID, owned: true }))
    expect(props.onPick).toHaveBeenCalledTimes(1)
    // Just paid: owned, whatever the search has not caught up with yet.
    expect(screen.getByText(/You own this starter/)).toBeTruthy()
  })

  it('shows Buy again for a restored pick the person did not pay for', async () => {
    shelf({ selected: { listingId: 'northwind-studio' } })
    await screen.findByRole('radio', { name: /^Studio North/ })
    expect(screen.getByRole('button', { name: 'Buy and continue' })).toBeTruthy()
  })

  it('follows the dialog’s pick: nothing chosen while it holds none, whatever was clicked', async () => {
    const { props, rerender } = shelf({ selected: null })
    const card = await screen.findByRole('radio', { name: /^Studio North/ })
    fireEvent.click(card)
    expect(props.onPick).toHaveBeenCalledWith(PAID)
    expect(card.getAttribute('aria-checked')).toBe('false')
    rerender(<StarterPickerShelf {...props} selected={{ listingId: 'northwind-studio' }} />)
    expect(screen.getByRole('radio', { name: /^Studio North/ }).getAttribute('aria-checked')).toBe('true')
    // A pick the dialog holds is not asked for by name: only one it opened on is.
    expect(mockFetch.mock.calls.every(([, url]) => !String(url).includes('include='))).toBe(true)
  })

  it('links the site starters guide from a search that found nothing', async () => {
    answering([])
    shelf({ search: 'zzz quantum bakery' })
    const link = await screen.findByRole('link', { name: 'How starters work' })
    expect(link.getAttribute('href')).toMatch(/\/building-sites\/site-templates\/site-starters$/)
  })
})
