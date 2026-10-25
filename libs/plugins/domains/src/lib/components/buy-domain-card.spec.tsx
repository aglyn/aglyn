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
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import BuyDomainCard, { prefillDomainFrom, priceLine } from './buy-domain-card.component'
import type { RegistrationsAnswer } from './domains-api'

/**
 * The Get a domain card (AGL-3962): what it says on each plan and state, the
 * reason it cannot buy shown before any click, and the prices of a result —
 * this year and every year after — side by side.
 */

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./domains-api', () => ({
  ...jest.requireActual('./domains-api'),
  useDomainsFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const READY: RegistrationsAnswer = {
  configured: true,
  billingPermission: true,
  canBuy: true,
  refusal: null,
  registrations: [],
  unassigned: [],
  contactDefaults: { firstName: 'Alex', lastName: 'Test', email: 'alex@testbakery.com' },
}

function answer(registrations: Partial<RegistrationsAnswer> = {}, offers: unknown[] = []) {
  request.mockImplementation(async (route: string) => {
    if (route === DOMAINS_API_ROUTES.registrations) return { ...READY, ...registrations }
    if (route === DOMAINS_API_ROUTES.search) return { offers }
    throw new Error(`unexpected ${route}`)
  })
}

const props = { hostId: 'host-1', org: { slug: 'test-org' }, connectedDomain: null }

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
})

afterEach(() => window.history.replaceState(null, '', '/'))

/** The searches the card asked for, by query. */
function searchedFor(): string[] {
  return request.mock.calls
    .filter(([route]) => route === DOMAINS_API_ROUTES.search)
    .map(([, options]) => (options as { query: { q: string } }).query.q)
}

describe('Get a domain', () => {
  it('names the plan that includes domains on a plan without them, and reads nothing', () => {
    render(<BuyDomainCard {...props} entitled={false} upgrade={{ billingHref: '/test-org/billing', canManageBilling: true }} />)
    expect(screen.getByText(/Starter plan and above/)).toBeTruthy()
    expect(screen.getByText('See plans')).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
  })

  it('draws nothing on a deployment that sells no names', async () => {
    answer({ configured: false })
    const { container } = render(<BuyDomainCard {...props} entitled />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('says why the site cannot buy before the click, and blocks the button', async () => {
    answer(
      {
        canBuy: false,
        refusal: { code: 'fraud-hold', message: 'Buying is paused for this workspace while a payment review is open. Contact support to finish it.' },
      },
      [{ domain: 'testbakery.com', available: true, firstYearCents: 1599, renewalCents: 1599 }],
    )
    render(<BuyDomainCard {...props} entitled />)
    expect(await screen.findByText(/payment review is open/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search for a domain'), { target: { value: 'test bakery' } })
    const buy = await screen.findByRole('button', { name: 'Buy' })
    expect((buy as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows each result with both prices, and a taken name as taken', async () => {
    answer({}, [
      { domain: 'testbakery.shop', available: true, firstYearCents: 499, renewalCents: 5199 },
      { domain: 'testbakery.com', available: false, firstYearCents: 0, renewalCents: 0 },
    ])
    render(<BuyDomainCard {...props} entitled />)
    await screen.findByText(/Search for a name for your site/)
    fireEvent.change(screen.getByLabelText('Search for a domain'), { target: { value: 'test bakery' } })
    expect(await screen.findByText('$4.99 the first year, then $51.99 a year')).toBeTruthy()
    expect(screen.getByText('Taken')).toBeTruthy()
  })

  it('lets a site with a domain buy another, into the workspace, and says so first (AGL-4040)', async () => {
    answer({ buyTarget: 'workspace' }, [
      { domain: 'testbakery.net', available: true, firstYearCents: 1599, renewalCents: 1599 },
    ])
    render(<BuyDomainCard {...props} connectedDomain="testbakery.com" entitled />)
    expect(await screen.findByText(/goes into your workspace’s domains/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search for a domain'), { target: { value: 'test bakery' } })
    const buy = await screen.findByRole('button', { name: 'Buy' })
    expect((buy as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(buy)
    expect(await screen.findByText(/not connected to a site/)).toBeTruthy()
  })

  it('links to the workspace’s Domains page from its header', async () => {
    answer()
    render(<BuyDomainCard {...props} entitled />)
    const link = await screen.findByRole('link', { name: 'All domains' })
    expect(link.getAttribute('href')).toBe('/test-org/domains')
  })

  it('names the domain an unassigned name would replace before connecting it', async () => {
    answer({
      unassigned: [
        {
          domain: 'testbakery.net', hostId: null, status: 'active', autoRenew: true,
          renewalCents: 1599, expiresAtMs: Date.parse('2027-10-19T00:00:00Z'), registeredAtMs: 1,
          registrantEmail: 'alex@testbakery.com', verifyByMs: null, verificationEmail: null,
          renewalFailing: false, failure: null, registrantName: 'Alex Test', contactVerified: true,
          contactPendingSinceMs: null, contactRejectedAtMs: null, origin: 'purchase', transferStatus: null, transferStartedAtMs: null,
        },
      ],
    })
    render(<BuyDomainCard {...props} connectedDomain="testbakery.com" entitled />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use for this site' }))
    expect(await screen.findByText(/This site uses testbakery.com now/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replace testbakery.com' })).toBeTruthy()
    expect(request.mock.calls.some(([route]) => route === DOMAINS_API_ROUTES.reconnect)).toBe(false)
  })

  it('manages a bought domain, and still offers another', async () => {
    answer({
      registrations: [
        {
          domain: 'testbakery.com', hostId: 'host-1', status: 'active', autoRenew: true,
          renewalCents: 1599, expiresAtMs: Date.parse('2027-10-19T00:00:00Z'), registeredAtMs: 1,
          registrantEmail: 'alex@testbakery.com',
          verifyByMs: Date.parse('2026-11-02T00:00:00Z'), verificationEmail: 'alex@testbakery.com',
          renewalFailing: false, failure: null, registrantName: 'Alex Test', contactVerified: false,
          contactPendingSinceMs: null, contactRejectedAtMs: null, origin: 'purchase', transferStatus: null, transferStartedAtMs: null,
        },
      ],
    })
    render(<BuyDomainCard {...props} entitled />)
    expect(await screen.findByText('Your domain')).toBeTruthy()
    expect(screen.getByText(/Confirm the email the registrar sent/)).toBeTruthy()
    expect(screen.getByText('Move to another registrar')).toBeTruthy()
    expect(screen.getByText('Get another domain')).toBeTruthy()
    expect(screen.getByLabelText('Search for a domain')).toBeTruthy()
  })
})

describe('?domain= from Billing (AGL-3955)', () => {
  const opened = (search: string) =>
    window.history.replaceState(null, '', `/test-org/hosts/host-1/custom-domain${search}`)

  it('opens the search with the name and searches it once', async () => {
    opened('?domain=TestBakery.com')
    answer({}, [{ domain: 'testbakery.com', available: true, firstYearCents: 1599, renewalCents: 1599 }])
    render(<BuyDomainCard {...props} entitled />)
    expect(await screen.findByText('$15.99 a year')).toBeTruthy()
    expect((screen.getByLabelText('Search for a domain') as HTMLInputElement).value).toBe('testbakery.com')
    expect(searchedFor()).toEqual(['testbakery.com'])
  })

  it('ignores a value that is not a name the card sells', async () => {
    for (const value of ['not%20a%20domain', 'example.us', 'https%3A%2F%2Fexample.com%2Fx', '%3Cscript%3E.com']) {
      request.mockReset()
      opened(`?domain=${value}`)
      answer()
      const { unmount } = render(<BuyDomainCard {...props} entitled />)
      await screen.findByText(/Search for a name for your site/)
      expect((screen.getByLabelText('Search for a domain') as HTMLInputElement).value).toBe('')
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(searchedFor()).toEqual([])
      unmount()
    }
  })

  it('still searches the name while the site already has a domain bought for it (AGL-4040)', async () => {
    opened('?domain=testbakery.com')
    answer({
      registrations: [
        {
          domain: 'testbakery.net', hostId: 'host-1', status: 'active', autoRenew: true,
          renewalCents: 1599, expiresAtMs: Date.parse('2027-10-19T00:00:00Z'), registeredAtMs: 1,
          registrantEmail: 'alex@testbakery.com', verifyByMs: null, verificationEmail: null,
          renewalFailing: false, failure: null, registrantName: 'Alex Test', contactVerified: false,
          contactPendingSinceMs: null, contactRejectedAtMs: null, origin: 'purchase', transferStatus: null, transferStartedAtMs: null,
        },
      ],
    })
    render(<BuyDomainCard {...props} entitled />)
    expect(await screen.findByText('Your domain')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(searchedFor()).toEqual(['testbakery.com'])
  })

  it('reads only a bare name under an ending the card sells', () => {
    expect(prefillDomainFrom('?domain=testbakery.com')).toBe('testbakery.com')
    expect(prefillDomainFrom('?domain=%20TestBakery.SHOP%20')).toBe('testbakery.shop')
    expect(prefillDomainFrom('?domain=www.testbakery.com')).toBe('')
    expect(prefillDomainFrom('?domain=testbakery')).toBe('')
    expect(prefillDomainFrom('?domain=')).toBe('')
    expect(prefillDomainFrom('')).toBe('')
  })
})

describe('priceLine', () => {
  it('reads the same price once, and both when the renewal differs', () => {
    const base = { domain: 'a.com', available: true, renewalCents: 1599 }
    expect(priceLine({ ...base, firstYearCents: 1599 })).toBe('$15.99 a year')
    expect(priceLine({ ...base, firstYearCents: 999 })).toBe('$9.99 the first year, then $15.99 a year')
  })
})
