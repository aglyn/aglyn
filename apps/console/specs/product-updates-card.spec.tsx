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
 * The account-level product-updates switch (AGL-3185): it shows what the
 * record says, on records a grant, off records a refusal, and the switch
 * reads back from the server rather than trusting its own click.
 *
 * AGL-3305: it names a decision an email made, and says what keeps a Yes from
 * arriving — with the one action the person has when it is theirs to undo.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PLATFORM_MARKETING_CONSENT_TEXT_VERSION } from '@aglyn/aglyn/app-utils/platform-marketing-consent'

const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1', getIdToken: async () => 'token-1' } }),
}))
// The shell is not under test; the JSX barrel would drag the whole design
// system into a spec about one switch.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children?: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))
jest.mock('../constants/docs-links', () => ({
  docsHelp: () => ({ title: 'Account', excerpt: 'help', href: '/docs/account' }),
}))

const { ProductUpdatesCard } = require('../components/account/product-updates-card.component')

const NOTHING = {
  decision: null,
  atMs: null,
  textVersion: null,
  sourceKind: null,
  promptDismissedAtMs: null,
  promptDue: true,
  currentTextVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
}
const DECIDED_AT = Date.UTC(2026, 8, 20, 12)

/** The server's record; a POST moves it the way the real route would. */
let mockStatus: Record<string, unknown> | null = null
const postedBodies: Array<Record<string, unknown>> = []
/** What the route's `?detail=hold` read answers after the next POST. */
let mockHoldAfterPost: Record<string, unknown> | null = null
const readUrls: string[] = []

beforeEach(() => {
  mockEnqueue.mockClear()
  postedBodies.length = 0
  readUrls.length = 0
  mockHoldAfterPost = null
  mockStatus = { ...NOTHING }
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.split('?')[0] !== '/api/auth/marketing-consent') throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') readUrls.push(url)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      postedBodies.push(body)
      mockStatus = {
        ...NOTHING,
        decision: body.decision,
        atMs: DECIDED_AT,
        sourceKind: body.source,
        textVersion: body.textVersion,
        promptDue: false,
        hold: body.decision === 'granted' ? mockHoldAfterPost : null,
        mailboxVerified: true,
      }
      return { ok: true, json: async () => ({ ok: true }), text: async () => '' }
    }
    if (!mockStatus) return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    return { ok: true, json: async () => mockStatus, text: async () => '' }
  }) as unknown as typeof fetch
})

const renderCard = async () => {
  await act(async () => {
    render(<ProductUpdatesCard />)
  })
}
const theSwitch = () => screen.getByLabelText('Product updates') as HTMLInputElement

describe('ProductUpdatesCard', () => {
  it('shows an off switch and says nothing is on record when nothing is', async () => {
    await renderCard()
    await waitFor(() => expect(theSwitch().disabled).toBe(false))
    expect(theSwitch().checked).toBe(false)
    expect(screen.getByText(/No preference on record/)).toBeTruthy()
  })

  it('shows an on switch and the day of a recorded grant', async () => {
    mockStatus = {
      ...NOTHING,
      decision: 'granted',
      atMs: DECIDED_AT,
      sourceKind: 'console-signup',
      promptDue: false,
    }
    await renderCard()
    await waitFor(() => expect(theSwitch().checked).toBe(true))
    expect(screen.getByText(/You opted in on /)).toBeTruthy()
  })

  it('turning it on records a grant from the preferences door and reads back', async () => {
    await renderCard()
    await waitFor(() => expect(theSwitch().disabled).toBe(false))
    await act(async () => {
      fireEvent.click(theSwitch())
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual({
      decision: 'granted',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    await waitFor(() => expect(theSwitch().checked).toBe(true))
    expect(screen.getByText(/You opted in on /)).toBeTruthy()
  })

  it('turning it off records a refusal, not an absence', async () => {
    mockStatus = { ...NOTHING, decision: 'granted', atMs: DECIDED_AT, promptDue: false }
    await renderCard()
    await waitFor(() => expect(theSwitch().checked).toBe(true))
    await act(async () => {
      fireEvent.click(theSwitch())
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual(
      expect.objectContaining({ decision: 'declined', source: 'console-preferences' }),
    )
    await waitFor(() => expect(theSwitch().checked).toBe(false))
    expect(screen.getByText(/You opted out on /)).toBeTruthy()
  })

  it('says so, and keeps the switch disabled, when the preference could not be loaded', async () => {
    mockStatus = null
    await renderCard()
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
    expect(theSwitch().disabled).toBe(true)
  })

  it('leaves the switch where it was when the write fails', async () => {
    ;(globalThis.fetch as jest.Mock).mockImplementation(
      async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
          : { ok: true, json: async () => mockStatus, text: async () => '' },
    )
    await renderCard()
    await waitFor(() => expect(theSwitch().disabled).toBe(false))
    await act(async () => {
      fireEvent.click(theSwitch())
    })
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.stringMatching(/could not be saved/),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(theSwitch().checked).toBe(false)
  })
})

describe('ProductUpdatesCard · the email doors (AGL-3305)', () => {
  it('asks the route for the hold detail — the card is its only reader', async () => {
    await renderCard()
    await waitFor(() => expect(readUrls).toContain('/api/auth/marketing-consent?detail=hold'))
  })

  it.each([
    ['email-unsubscribe', 'declined', /You unsubscribed from .+’s emails on /],
    ['email-preferences', 'declined', /You left product updates from an email on /],
    ['email-resubscribe', 'granted', /You resubscribed from an email on /],
    ['email-preferences', 'granted', /You chose product updates again from an email on /],
  ])('names a %s %s as an email’s doing', async (sourceKind, decision, sentence) => {
    mockStatus = { ...NOTHING, decision, atMs: DECIDED_AT, sourceKind, promptDue: false }
    await renderCard()
    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it('offers Resume for an unsubscribe a verified account may undo, and records a Yes', async () => {
    mockStatus = {
      ...NOTHING,
      decision: 'granted',
      atMs: DECIDED_AT,
      sourceKind: 'console-signup',
      promptDue: false,
      hold: { kind: 'unsubscribed' },
      mailboxVerified: true,
    }
    await renderCard()
    expect(await screen.findByText(/none are being sent/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual(
      expect.objectContaining({ decision: 'granted', source: 'console-preferences' }),
    )
    // The route reopened the list; the read-back carries no hold.
    await waitFor(() => expect(screen.queryByText(/none are being sent/)).toBeNull())
  })

  it('asks an unverified account to verify instead of offering Resume', async () => {
    mockStatus = {
      ...NOTHING,
      decision: 'granted',
      atMs: DECIDED_AT,
      promptDue: false,
      hold: { kind: 'unsubscribed' },
      mailboxVerified: false,
    }
    await renderCard()
    expect(await screen.findByText(/Verify your email address/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('explains a bounce and offers nothing — it is not a preference', async () => {
    mockStatus = {
      ...NOTHING,
      decision: 'granted',
      atMs: DECIDED_AT,
      promptDue: false,
      hold: { kind: 'paused', reason: 'bounce' },
      mailboxVerified: true,
    }
    await renderCard()
    expect(await screen.findByText(/could not be delivered/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('warns instead of celebrating when a Yes is still held', async () => {
    mockHoldAfterPost = { kind: 'paused', reason: 'complaint' }
    await renderCard()
    await waitFor(() => expect(theSwitch().disabled).toBe(false))
    await act(async () => {
      fireEvent.click(theSwitch())
    })
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        'Saved, but product updates are still on hold.',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(await screen.findByText(/reported as spam/)).toBeTruthy()
  })
})
