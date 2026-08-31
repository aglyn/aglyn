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
 * A member account door reports to the HOST's GA4 property (AGL-1591).
 *
 * `sign_up` and `login` are GA4 recommended events, and every other step of a
 * storefront funnel — `view_item`, `add_to_cart`, `begin_checkout`,
 * `purchase` — already reported one. The account door was the single hole in
 * a funnel the operator can otherwise follow end to end: a site could switch
 * its whole audience to accounts and see nothing.
 *
 * ## Asserted against `window.gtag`, not against a mocked tracker
 *
 * The tenant runtime registers no analytics transport, so `window.gtag` IS the
 * delivery path to the host's property. Spying on `trackEvent` instead would
 * pass on an event that never left the module — and would keep passing if the
 * name fell out of the taxonomy, if the sanitizer stripped the params, or if
 * the reserved-name refusal started rejecting it. Everything from the button
 * to the wire runs here.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomerAccount from './account'
import MemberSignin from './member-signin'
import MemberSignup from './member-signup'
import { memberNavigation } from '../utils/member-continue'

const siteFetch = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => siteFetch,
}))

const gtag = jest.fn()
let assign: jest.SpyInstance

/** Every hit gtag received for `name`, as GA4 would see it. */
function hitsFor(name: string): Record<string, unknown>[] {
  return gtag.mock.calls
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => (call[2] ?? {}) as Record<string, unknown>)
}

const ok = { ok: true, json: async () => ({}) }

beforeEach(() => {
  gtag.mockClear()
  siteFetch.mockReset().mockResolvedValue(ok)
  ;(window as unknown as { gtag: unknown }).gtag = gtag
  /*
   * These blocks navigate on success, and jsdom's `location` is not patchable
   * — a real assign throws "Not implemented" out of the handler, aborting it
   * BEFORE the assertion and immediately after the event fires. Stubbing the
   * seam is the difference between this suite testing the tracking and
   * testing jsdom.
   */
  assign = jest.spyOn(memberNavigation, 'assign').mockImplementation(() => undefined)
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

/** Fill a labelled field the way a visitor would. */
function type(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('the standalone sign-up block', () => {
  it('reports sign_up to the host once the registration is accepted', async () => {
    render(<MemberSignup />)
    type('Email', 'member@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(hitsFor('sign_up')).toHaveLength(1))
    expect(hitsFor('sign_up')[0]).toMatchObject({ method: 'password' })
  })

  it('reports NOTHING when the registration is refused', async () => {
    /*
     * The case that decides whether the number means anything. A `sign_up`
     * count inflated by every rejected attempt — a taken email, a short
     * password — reads as a healthy funnel with a broken activation step, and
     * sends the operator looking for a problem one screen further on.
     */
    siteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Email already registered' }),
    })
    render(<MemberSignup />)
    type('Email', 'taken@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await screen.findByText('Email already registered')
    expect(hitsFor('sign_up')).toHaveLength(0)
  })

  it('fires BEFORE the navigation that tears the page down', async () => {
    // The block navigates in the same handler. An event handed to gtag after
    // the assign is an event on a document that is already going away.
    render(<MemberSignup />)
    type('Email', 'member@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(gtag).toHaveBeenCalled()
    expect(gtag.mock.invocationCallOrder[0]).toBeLessThan(
      assign.mock.invocationCallOrder[0],
    )
  })
})

describe('the customer-account block', () => {
  /**
   * Routed by endpoint rather than a single blanket answer.
   *
   * The block reads `/api/membership/me` on mount to decide which panel to
   * render, and anonymous is the state in which the sign-in and create tabs
   * exist at all. Answering every call the same way makes the whole suite a
   * lie in one direction or the other: signed-in and the tabs never render,
   * signed-out and the credentials are refused by the very request under
   * test.
   */
  const routed = (auth: unknown = ok) =>
    siteFetch.mockImplementation(async (url: string) =>
      // Matched on `/account`, NOT on `/me`: `/api/membership/login` contains
      // the substring `/me`, so the shorter test routes the request under
      // test into the signed-out answer and every case fails for a reason
      // that has nothing to do with analytics.
      String(url).includes('/account') ? { ok: false, json: async () => ({}) } : auth,
    )

  beforeEach(() => {
    routed()
  })

  it('reports login on the sign-in tab', async () => {
    render(<CustomerAccount />)
    await screen.findByRole('tab', { name: 'Sign in' })
    type('Email', 'member@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(hitsFor('login')).toHaveLength(1))
    expect(hitsFor('login')[0]).toMatchObject({ method: 'password' })
    // A returning visitor is not a new one.
    expect(hitsFor('sign_up')).toHaveLength(0)
  })

  it('reports sign_up — and NOT login — on the create tab', async () => {
    /*
     * The create path signs in immediately afterwards, because registration
     * does not set the cookie on every deployment. That repair must not
     * report a second event: a `login` for every brand-new member turns a
     * returning-visitor metric into a copy of the signup one, and the two
     * would move together forever without either being wrong on its face.
     */
    render(<CustomerAccount />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Create account' }))
    type('Email', 'new@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(hitsFor('sign_up')).toHaveLength(1))
    expect(hitsFor('login')).toHaveLength(0)
  })

  it('reports nothing when the credentials are refused', async () => {
    routed({ ok: false, json: async () => ({ error: 'Wrong email or password' }) })
    render(<CustomerAccount />)
    await screen.findByRole('tab', { name: 'Sign in' })
    type('Email', 'member@example.com')
    type('Password', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByText('Wrong email or password')
    expect(hitsFor('login')).toHaveLength(0)
  })
})

describe('the standalone sign-in block', () => {
  it('reports login once the credentials are accepted', async () => {
    render(<MemberSignin />)
    type('Email', 'member@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(hitsFor('login')).toHaveLength(1))
    expect(hitsFor('login')[0]).toMatchObject({ method: 'password' })
  })

  it('reports nothing when they are refused', async () => {
    siteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Wrong email or password' }),
    })
    render(<MemberSignin />)
    type('Email', 'member@example.com')
    type('Password', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await screen.findByText('Wrong email or password')
    expect(hitsFor('login')).toHaveLength(0)
  })
})

describe('what reaches the host', () => {
  it('THE CONTROL: nothing at all when the host has no GA configured', async () => {
    /*
     * `window.gtag` is defined by the host's own Analytics tag, which does not
     * exist until they configure GA and the visitor consents. Every assertion
     * above is only meaningful because this proves the absence of a hit is a
     * state this code can actually be in — and it proves the account door
     * still works when it is, rather than throwing on a missing global.
     */
    delete (window as unknown as { gtag?: unknown }).gtag
    render(<MemberSignup />)
    type('Email', 'member@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(gtag).not.toHaveBeenCalled()
  })

  it('carries no email, name or password into the hit', async () => {
    // An account form is the densest source of personal data on a storefront,
    // and the params are shipped to a third party. `method` is the whole
    // payload GA4 asks for, and it is the whole payload it gets.
    render(<MemberSignup />)
    type('Name', 'Ada Lovelace')
    type('Email', 'ada@example.com')
    type('Password', 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(hitsFor('sign_up')).toHaveLength(1))
    const serialized = JSON.stringify(hitsFor('sign_up')[0])
    expect(serialized).not.toContain('ada@example.com')
    expect(serialized).not.toContain('Ada Lovelace')
    expect(serialized).not.toContain('correct horse battery')
  })
})
