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
 *
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react'

/**
 * The publisher's view of review (AGL-1079).
 *
 * AGL-966's guarantee — a new version waits in the queue while the
 * previously approved one keeps installing — was true and invisible from
 * the day it shipped. The assertions that matter here are the ones a
 * publisher acts on: which version customers are actually getting, why one
 * was sent back, and that a version predating per-version review is not
 * described as waiting for a reviewer who is never coming.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

import ListingReviewStatus from '../components/marketplace/listing-review-status.component'

const VERSION = {
  publishedAtMs: 1_760_000_000_000,
  sha256: 'abc123def456789',
  grandfathered: false,
  signed: false,
  changelog: '',
  rejectionReason: '',
  activeInstalls: 0,
  attestation: [] as string[],
}

function respondWith(payload: unknown) {
  ;(global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  })
}

const open = () =>
  render(<ListingReviewStatus listingId="listing-1" isPlugin />)

describe('ListingReviewStatus (AGL-1079)', () => {
  it('states the AGL-966 guarantee when a newer version is in review', async () => {
    respondWith({
      latestVersion: '1.0.3',
      latestApprovedVersion: '1.0.2',
      versions: [
        { ...VERSION, version: '1.0.3', reviewState: 'pending' },
        { ...VERSION, version: '1.0.2', reviewState: 'approved' },
      ],
    })
    open()
    // The whole guarantee, in the sentence nobody has ever read.
    await waitFor(() =>
      expect(
        screen.getByText(
          /v1\.0\.3 is in review\. New installs get v1\.0\.2 until it is approved/,
        ),
      ).toBeTruthy(),
    )
  })

  it('reports the approved version as what installs today', async () => {
    respondWith({
      latestVersion: '1.0.2',
      latestApprovedVersion: '1.0.2',
      versions: [{ ...VERSION, version: '1.0.2', reviewState: 'approved' }],
    })
    open()
    await waitFor(() =>
      expect(
        screen.getByText(/v1\.0\.2 is approved and is what installs today/),
      ).toBeTruthy(),
    )
    expect(screen.getByText('Installs today')).toBeTruthy()
  })

  it('shows the rejection reason on the version it belongs to', async () => {
    // It reached an email and nowhere else, which is where it got buried.
    respondWith({
      latestVersion: '2.0.0',
      latestApprovedVersion: '1.0.0',
      versions: [
        {
          ...VERSION,
          version: '2.0.0',
          reviewState: 'rejected',
          rejectionReason: 'The network allowlist includes hosts you do not use.',
        },
        { ...VERSION, version: '1.0.0', reviewState: 'approved' },
      ],
    })
    open()
    await waitFor(() =>
      expect(
        screen.getByText(/network allowlist includes hosts you do not use/),
      ).toBeTruthy(),
    )
    expect(screen.getByText('Rejected')).toBeTruthy()
  })

  it('does not describe a grandfathered version as waiting for review', async () => {
    // Published before review was per-version (AGL-966): there is no verdict
    // and no reviewer coming. "In review" would promise one; "Approved"
    // would claim a judgement nobody made.
    respondWith({
      latestVersion: '0.9.0',
      latestApprovedVersion: '0.9.0',
      versions: [
        {
          ...VERSION,
          version: '0.9.0',
          reviewState: 'pending',
          grandfathered: true,
        },
      ],
    })
    open()
    await waitFor(() =>
      expect(screen.getByText('Published before review')).toBeTruthy(),
    )
    expect(screen.queryByText('In review')).toBeNull()
  })

  it('says what a listing edit does and does not do to review', async () => {
    respondWith({
      latestVersion: '1.0.0',
      latestApprovedVersion: '1.0.0',
      versions: [{ ...VERSION, version: '1.0.0', reviewState: 'approved' }],
    })
    open()
    await waitFor(() =>
      expect(
        screen.getByText(/will not send anything back to the queue/),
      ).toBeTruthy(),
    )
  })

  /**
   * The publisher-testing carve-out, said out loud.
   *
   * `install-plugin` deliberately lets the publisher install their own
   * unapproved version — you cannot test a version you cannot install. The
   * first cut of this card said "Nothing installs it yet" on a page only
   * the publisher reads, over a version that was installed on one of their
   * sites at that moment. Stating a buyer-side fact to the one person it
   * is false for is worse than saying nothing.
   */
  it('does not claim nothing installs when the publisher has installed it', async () => {
    respondWith({
      latestVersion: '1.0.0',
      latestApprovedVersion: '',
      versions: [
        {
          ...VERSION,
          version: '1.0.0',
          reviewState: 'pending',
          activeInstalls: 1,
        },
      ],
    })
    open()
    await waitFor(() =>
      expect(screen.getByText(/nobody else can install this/)).toBeTruthy(),
    )
    // The claim that was false: it must not survive anywhere on the card.
    expect(screen.queryByText(/Nothing installs it yet/)).toBeNull()
    expect(screen.queryByText(/so nothing installs/)).toBeNull()
    // And the live unreviewed install is named rather than left implied.
    // "Installs", not "sites" (AGL-1418): `activeInstalls` counts pins, and an
    // org-wide pin covers every site in the organization — so calling it a
    // site count understated the exposure this warning exists to raise.
    expect(
      screen.getByText(
        /1 of your installs is running this version, which no reviewer has approved/,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/of your sites/)).toBeNull()
  })

  it('does not warn about live installs on an approved version', async () => {
    respondWith({
      latestVersion: '1.0.0',
      latestApprovedVersion: '1.0.0',
      versions: [
        {
          ...VERSION,
          version: '1.0.0',
          reviewState: 'approved',
          activeInstalls: 3,
        },
      ],
    })
    open()
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy())
    expect(screen.queryByText(/no reviewer has approved/)).toBeNull()
  })

  /**
   * The kill switch, said to the publisher it happened to (AGL-2328).
   *
   * Staff cannot revoke a version without typing a reason. The consumer
   * whose site broke was told it; the publisher who caused it was told
   * nothing, on the one page that exists to say what state their versions
   * are in — where a revoked version still read "Approved", because
   * approval is what `reviewState` records and revocation is not.
   */
  describe('a revoked version (AGL-2328)', () => {
    const REVOKED = {
      latestVersion: '1.0.2',
      latestApprovedVersion: '1.0.2',
      revocationReason: 'Exfiltrates form submissions to an undisclosed endpoint.',
      revokedAtMs: 1_770_000_000_000,
      versions: [
        {
          ...VERSION,
          version: '1.0.2',
          reviewState: 'approved',
          revoked: true,
        },
      ],
    }

    it('shows the reason staff were required to type', async () => {
      respondWith(REVOKED)
      open()
      await waitFor(() =>
        expect(
          screen.getByText(
            /Reason: Exfiltrates form submissions to an undisclosed endpoint\./,
          ),
        ).toBeTruthy(),
      )
      expect(screen.getByText('Disabled')).toBeTruthy()
    })

    it('keeps the review verdict beside it, not instead of it', async () => {
      // A version is approved and THEN revoked. Collapsing the two would
      // erase a verdict the publisher earned, and would also hide that the
      // bytes passed review — which is the fact that tells them the problem
      // is not their submission process.
      respondWith(REVOKED)
      open()
      await waitFor(() => expect(screen.getByText('Disabled')).toBeTruthy())
      expect(screen.getByText('Approved')).toBeTruthy()
    })

    it('stops calling it what installs today', async () => {
      // The headline sentence and the row chip both claimed it. The
      // installer answers a 409, so this is the sentence a publisher reads
      // just before opening a ticket about installs that stopped working.
      respondWith(REVOKED)
      open()
      await waitFor(() =>
        expect(
          screen.getByText(/v1\.0\.2 was disabled by the platform/),
        ).toBeTruthy(),
      )
      expect(screen.queryByText('Installs today')).toBeNull()
      expect(
        screen.queryByText(/v1\.0\.2 is approved and is what installs today/),
      ).toBeNull()
    })

    it('does not print an empty quotation when no reason was recorded', async () => {
      // Revocations written before the reason was required carry none. An
      // empty "Reason:" reads as "no reason given", which is a different
      // and worse claim than saying nothing.
      respondWith({ ...REVOKED, revocationReason: '', revokedAtMs: null })
      open()
      await waitFor(() => expect(screen.getByText('Disabled')).toBeTruthy())
      expect(screen.queryByText(/Reason:/)).toBeNull()
      expect(screen.queryByText(/Disabled 1[/-]/)).toBeNull()
      // The fact itself still reaches them — it is the reason that is absent.
      expect(
        screen.getByText(/The platform disabled this version/),
      ).toBeTruthy()
    })

    it('says nothing about revocation on a healthy listing', async () => {
      respondWith({
        latestVersion: '1.0.2',
        latestApprovedVersion: '1.0.2',
        versions: [{ ...VERSION, version: '1.0.2', reviewState: 'approved' }],
      })
      open()
      await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy())
      expect(screen.queryByText('Disabled')).toBeNull()
      expect(screen.queryByText(/Reason:/)).toBeNull()
      expect(screen.getByText('Installs today')).toBeTruthy()
    })
  })

  it('renders nothing for a non-plugin listing', () => {
    respondWith({ versions: [], latestVersion: '', latestApprovedVersion: '' })
    const { container } = render(
      <ListingReviewStatus listingId="listing-1" isPlugin={false} />,
    )
    expect(container.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
