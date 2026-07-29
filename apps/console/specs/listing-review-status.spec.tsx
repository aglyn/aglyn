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
    expect(
      screen.getByText(
        /1 of your sites is running this version, which no reviewer has approved/,
      ),
    ).toBeTruthy()
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

  it('renders nothing for a non-plugin listing', () => {
    respondWith({ versions: [], latestVersion: '', latestApprovedVersion: '' })
    const { container } = render(
      <ListingReviewStatus listingId="listing-1" isPlugin={false} />,
    )
    expect(container.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
