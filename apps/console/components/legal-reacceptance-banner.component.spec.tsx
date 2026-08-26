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

/** A day this account agreed on, used by the wording tests below. */
const ACCEPTED_ISO = '2026-08-23T14:05:00.000Z'

/**
 * The date exactly as the component formats it. Computed the same way rather
 * than hard-coded, because the assertion under test is that a REAL date is
 * rendered in the right place — not which locale or timezone the runner is
 * in, which is not a property of this component.
 */
const ACCEPTED_ON = new Date(ACCEPTED_ISO).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

/** Everything the alert renders, as one string. */
function bannerText(): string {
  return document.querySelector('.MuiAlert-message')?.textContent ?? ''
}

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
      latestAcceptedAt: ACCEPTED_ISO,
      changedDocumentKeys: ['terms'],
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
    expect(bannerText()).toContain('We’ve updated them since')
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
    mockStatusResponse.body = neverAccepted()
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    expect(bannerText()).toMatch(/don’t have a record of your acceptance/i)
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

/**
 * Okay then leave it and they can agree again, but don't
 * phrase it that they havent agreed before it creates confusion and
 * frustration, I know I agree yesterday (but we updated overnight).
 *
 * The behaviour is unchanged — a superseded version still prompts. What these
 * tests pin is that the prompt a RETURNING acceptor sees is not the prompt
 * built for an account we hold nothing for. The regression this guards is a
 * copy edit that quietly merges the two branches back into one voice, which
 * is how the defect arose in the first place.
 */
function neverAccepted() {
  return {
    currentVersion: LEGAL_DOCUMENT_VERSION,
    reacceptanceRequired: true,
    reacceptanceReason: 'never-accepted',
    latestAcceptedVersion: null,
    latestAcceptedAt: null,
    changedDocumentKeys: null,
  }
}

/** Phrasings that must never reach somebody who HAS agreed before. */
const ACCUSATORY = [
  /no record/i,
  /have not accepted/i,
  /haven’t accepted/i,
  /acceptance required/i,
]

describe('AGL-2316 · the wording a returning acceptor sees', () => {
  it('LEADS with the acknowledgement and names the day they agreed', async () => {
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    const text = bannerText()

    // The acknowledgement is the FIRST thing in the alert, not a footnote
    // after the ask.
    expect(text.indexOf('Thanks for agreeing')).toBe(0)
    // A date, not a version id — "you last agreed to v1" is engineer-facing.
    expect(text).toContain(` on ${ACCEPTED_ON}.`)
    expect(text).toContain('We’ve updated them since')
    // Nothing that reads as a first-time ask.
    for (const phrase of ACCUSATORY) expect(text).not.toMatch(phrase)
    // And no raw version id anywhere in the customer copy.
    expect(text).not.toMatch(/\bv\d+\b/)
  })

  it('still acknowledges when the record carries NO timestamp', async () => {
    // `acceptedAt` is documented nullable, and `strictNullChecks` is off, so
    // an unguarded date sentence prints the epoch or the word "undefined".
    ;(mockStatusResponse.body as any).latestAcceptedAt = null
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    const text = bannerText()

    expect(text.indexOf('You’ve already agreed')).toBe(0)
    expect(text).toContain('We’ve updated them since')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('Invalid Date')
    expect(text).not.toContain('1970')
    for (const phrase of ACCUSATORY) expect(text).not.toMatch(phrase)
  })

  it('names WHICH documents moved, when the comparison ran', async () => {
    ;(mockStatusResponse.body as any).changedDocumentKeys = ['terms', 'privacy']
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    expect(bannerText()).toContain(
      'What changed: the Terms of Service and the Privacy Policy.',
    )
  })

  it('claims NOTHING about what changed when the comparison could not run', async () => {
    // Null is UNKNOWN, not "nothing changed". Inventing a changelog is worse
    // than omitting one.
    ;(mockStatusResponse.body as any).changedDocumentKeys = null
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    const text = bannerText()
    expect(text).not.toContain('What changed')
    // The reassurance still shows — it does not depend on the diff.
    expect(text).toContain('Your earlier agreement stays on record')
  })

  it('keeps the no-record copy as a RECORDS GAP, not an accusation', async () => {
    mockStatusResponse.body = neverAccepted()
    render(<LegalReacceptanceBanner />)
    await screen.findByRole('button', { name: 'I agree' })
    const text = bannerText()

    expect(text).toContain('on this account')
    // Blames the door, not the person.
    expect(text).toMatch(/single sign-on or an invite that never showed one/i)
    // And it must NOT borrow the returning-acceptor acknowledgement, which
    // would assert an acceptance we do not hold.
    expect(text).not.toContain('Thanks for agreeing')
    expect(text).not.toContain('You’ve already agreed')
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
