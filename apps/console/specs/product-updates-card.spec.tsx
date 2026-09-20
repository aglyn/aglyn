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

beforeEach(() => {
  mockEnqueue.mockClear()
  postedBodies.length = 0
  mockStatus = { ...NOTHING }
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/auth/marketing-consent') throw new Error(`unexpected ${url}`)
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
