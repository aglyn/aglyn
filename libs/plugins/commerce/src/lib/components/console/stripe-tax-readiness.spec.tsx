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
 * The Taxes card's live Stripe Tax state and the Payments card's notice
 * (AGL-4245). The route is mocked at `authorizedFetch`; the route itself is
 * pinned in `server/tax-readiness.spec.ts`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchMock = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => fetchMock(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin' } }),
  useStoreSettingsHref: (_hostId: string, page: string) => `/acme/hosts/shop/products/${page}`,
}))

import type { StoreTaxReadiness } from '../../model/commerce-tax-readiness'
import CheckoutTaxBlockedNotice from './checkout-tax-blocked-notice.component'
import { StripeTaxReadinessPanel, useStoreTaxReadiness } from './stripe-tax-readiness.component'

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })

function answer(extra: Partial<StoreTaxReadiness> = {}): StoreTaxReadiness {
  return {
    mode: 'stripe',
    direct: true,
    stripeTax: { readable: true, active: false, missing: ['head-office', 'registration'], hasRegistration: false },
    blocked: 'stripe-tax-not-active',
    refusedAtMs: null,
    ...extra,
  }
}

function Panel(props: { savedMode: string | null; onChooseMode?: (mode: string) => void }) {
  const readiness = useStoreTaxReadiness('host-1', props.savedMode)
  return (
    <StripeTaxReadinessPanel
      readiness={readiness}
      savedMode={props.savedMode}
      onChooseMode={props.onChooseMode ?? (() => undefined)}
    />
  )
}

beforeEach(() => fetchMock.mockReset())

describe('StripeTaxReadinessPanel (AGL-4245)', () => {
  it('says shoppers can’t check out, lists what is left, and links to Stripe', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<Panel savedMode="stripe" />)

    expect(await screen.findByText('Shoppers can’t check out until Stripe Tax is on')).toBeTruthy()
    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['Add your business address in Stripe Tax.', 'Add at least one place you collect tax.'])
    const settings = screen.getByRole('link', { name: 'Open Stripe Tax settings' })
    expect(settings.getAttribute('href')).toBe('https://dashboard.stripe.com/settings/tax')
    expect(settings.getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('link', { name: 'Open tax registrations' }).getAttribute('href')).toBe(
      'https://dashboard.stripe.com/tax/registrations',
    )
    expect(fetchMock.mock.calls[0][1]).toBe('/api/commerce/tax-readiness?hostId=host-1')
  })

  it('warns before Stripe Tax is saved, and offers the options that work today', async () => {
    const onChooseMode = jest.fn()
    fetchMock.mockReturnValueOnce(reply(answer({ mode: 'manual', blocked: null })))
    render(<Panel savedMode="manual" onChooseMode={onChooseMode} />)

    expect(await screen.findByText('Stripe Tax isn’t on in your Stripe account yet')).toBeTruthy()
    expect(screen.getByText(/If you save Stripe Tax now, shoppers can’t check out until it is on/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Don’t collect sales tax' }))
    expect(onChooseMode).toHaveBeenCalledWith('none')
    fireEvent.click(screen.getByRole('button', { name: 'Use manual rates' }))
    expect(onChooseMode).toHaveBeenCalledWith('manual')
  })

  it('reads again past the cache on Check again', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<Panel savedMode="stripe" />)
    const checkAgain = await screen.findByRole('button', { name: 'Check again' })
    fetchMock.mockReturnValueOnce(
      reply(
        answer({
          stripeTax: { readable: true, active: true, missing: [], hasRegistration: true },
          blocked: null,
        }),
      ),
    )
    fireEvent.click(checkAgain)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][1]).toBe('/api/commerce/tax-readiness?hostId=host-1&fresh=1')
    expect(await screen.findByText(/Stripe Tax is on in your Stripe account/)).toBeTruthy()
  })

  it('shows a quiet confirmation when Stripe Tax is on, and says when no place is added', async () => {
    fetchMock.mockReturnValueOnce(
      reply(answer({ stripeTax: { readable: true, active: true, missing: [], hasRegistration: false }, blocked: null })),
    )
    render(<Panel savedMode="stripe" />)
    expect(await screen.findByText(/Stripe Tax is on in your Stripe account/)).toBeTruthy()
    expect(screen.getByText('Stripe Tax adds no tax until you add at least one place you collect tax.')).toBeTruthy()
    expect(screen.queryByText(/can’t check out/)).toBeNull()
  })

  it('has nothing to set up for a store on the platform account', async () => {
    fetchMock.mockReturnValueOnce(reply(answer({ direct: false, stripeTax: null, blocked: null })))
    render(<Panel savedMode="stripe" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByText('Stripe Tax works out the tax for each buyer’s location at checkout.')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('CheckoutTaxBlockedNotice (AGL-4245)', () => {
  it('names a store that never chose and links to Taxes', async () => {
    fetchMock.mockReturnValueOnce(reply(answer({ mode: null, direct: false, stripeTax: null, blocked: 'tax-undecided' })))
    render(<CheckoutTaxBlockedNotice hostId="host-1" />)
    expect(await screen.findByText('Shoppers can’t check out right now')).toBeTruthy()
    expect(screen.getByText(/hasn’t chosen how it handles sales tax/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Taxes' }).getAttribute('href')).toBe('/acme/hosts/shop/products/taxes')
  })

  it('names Stripe Tax that is not on', async () => {
    fetchMock.mockReturnValueOnce(reply(answer()))
    render(<CheckoutTaxBlockedNotice hostId="host-1" />)
    expect(await screen.findByText(/Stripe Tax isn’t on in your Stripe account yet/)).toBeTruthy()
  })

  it('draws nothing when checkout is not blocked, or the read fails', async () => {
    fetchMock.mockReturnValueOnce(reply(answer({ blocked: null })))
    const { container, unmount } = render(<CheckoutTaxBlockedNotice hostId="host-1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    unmount()
    fetchMock.mockReturnValueOnce(reply({}, 500))
    const failed = render(<CheckoutTaxBlockedNotice hostId="host-1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(failed.container.textContent).toBe('')
  })
})
