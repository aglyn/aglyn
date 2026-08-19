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
 * The re-acceptance ask, as a customer meets it (AGL-2316).
 *
 * A capability is not a feature until a surface exposes it, and this banner
 * is the only place in the product where "the Terms moved" turns into
 * something a user can act on. Every property below is one where the failure
 * is silent rather than loud:
 *
 *   - it FIRES when the deploy's version is past what they accepted;
 *   - it does NOT fire when it is not — the half a hard-wired `true` passes
 *     the first test without;
 *   - the acceptance it records names the RE-ACCEPTANCE door, not a sign-up
 *     one, because the record is what a dispute reads and "agreed at sign-up"
 *     is a different fact;
 *   - a status read that FAILED shows nothing. Nagging a paying customer to
 *     re-accept because Firestore blinked is the cost of getting that wrong.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LegalReacceptanceBanner from './legal-reacceptance-banner.component'
import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'

let mockUser: { getIdToken: () => Promise<string> } | undefined
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

// Typed with the real signature so `mock.calls[0][1]` is a version and not
// an index into an empty tuple — an untyped `jest.fn()` types its calls as
// `[]` and the assertions below stop compiling.
const mockPost = jest.fn(
  async (_user: unknown, _version: string, _context: string) => true,
)
jest.mock('../utils/legal-consent', () => ({
  postLegalAcceptance: (...args: unknown[]) => (mockPost as any)(...args),
}))

let mockStatusResponse: { ok: boolean; body?: unknown }

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { getIdToken: async () => 'token' }
  mockStatusResponse = {
    ok: true,
    body: {
      currentVersion: LEGAL_DOCUMENT_VERSION,
      reacceptanceRequired: true,
      reacceptanceReason: 'version-superseded',
      latestAcceptedVersion: 'v1',
    },
  }
  ;(global as any).fetch = jest.fn(async () => ({
    ok: mockStatusResponse.ok,
    json: async () => mockStatusResponse.body,
  }))
})

describe('AGL-2316 · when the banner appears', () => {
  it('FIRES when the published version moved past what was accepted', async () => {
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    // The copy names both versions, because "please re-agree" with no reason
    // is the kind of prompt people click through without reading.
    expect(
      screen.getByText(/You last agreed to version v1/),
    ).toBeTruthy()
    expect(
      screen.getByText(
        new RegExp(`current version is ${LEGAL_DOCUMENT_VERSION}`),
      ),
    ).toBeTruthy()
  })

  it('DOES NOT fire when the current version is already accepted', async () => {
    mockStatusResponse.body = {
      currentVersion: LEGAL_DOCUMENT_VERSION,
      reacceptanceRequired: false,
      reacceptanceReason: 'none',
      latestAcceptedVersion: LEGAL_DOCUMENT_VERSION,
    }
    render(<LegalReacceptanceBanner />)
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull()
  })

  it('asks differently when there is no record at all', async () => {
    mockStatusResponse.body = {
      currentVersion: LEGAL_DOCUMENT_VERSION,
      reacceptanceRequired: true,
      reacceptanceReason: 'never-accepted',
      latestAcceptedVersion: null,
    }
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    expect(
      screen.getByText(/no record of your acceptance/i),
    ).toBeTruthy()
  })

  it('stays silent when the status read failed', async () => {
    mockStatusResponse = { ok: false }
    render(<LegalReacceptanceBanner />)
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull()
  })

  it('does not ask a signed-out visitor, or read anything for one', async () => {
    mockUser = undefined
    render(<LegalReacceptanceBanner />)
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull()
    expect((global as any).fetch).not.toHaveBeenCalled()
  })
})

describe('AGL-2316 · what the click records', () => {
  it('records the deploy’s version through the re-acceptance door', async () => {
    render(<LegalReacceptanceBanner />)
    const agree = await screen.findByRole('button', { name: 'I agree' })
    fireEvent.click(agree)

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0][1]).toBe(LEGAL_DOCUMENT_VERSION)
    // Not `signup-password`. The door is part of the evidence.
    expect(mockPost.mock.calls[0][2]).toBe('reaccept-console')
  })

  it('goes away once the acceptance is recorded', async () => {
    render(<LegalReacceptanceBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'I agree' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull(),
    )
  })

  it('stays put when the record did NOT land', async () => {
    // A banner that hides itself on a failed write is a consent record that
    // silently does not exist.
    mockPost.mockResolvedValueOnce(false)
    render(<LegalReacceptanceBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'I agree' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'I agree' })).not.toBeNull()
  })
})
