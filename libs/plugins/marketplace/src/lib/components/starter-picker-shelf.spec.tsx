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
