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

import { render, screen } from '@testing-library/react'
import ListingVerificationRequest from './listing-verification-request.component'

/**
 * The Verified badge's door asks "Edit the publisher profile" (AGL-4047), as
 * its route does. Without the key the card stays on screen with its buttons
 * off and the permission named, rather than offering a press the route
 * refuses.
 */

const REFUSAL =
  'Your role does not include "Edit the publisher profile" — ask an organization admin'

const LISTED = { profileId: 'org-1', reviewStatus: 'listed' }

const open = (
  listing: Record<string, unknown>,
  permissions?: Record<string, boolean | undefined>,
) =>
  render(
    <ListingVerificationRequest
      listingId="listing-1"
      listing={listing as never}
      viewerOrgId="org-1"
      user={null}
      isPlugin
      permissions={permissions}
    />,
  )

const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement

describe('ListingVerificationRequest asks "Edit the publisher profile" (AGL-4047)', () => {
  it('CONTROL: with the key, the ask is offered and nothing is named', () => {
    open(LISTED, { 'marketplace.publisherProfile': true })
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('an absent key reads as allowed while the map loads', () => {
    open(LISTED)
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('without it, Request verification and the agreement are off, with the permission named', () => {
    open(LISTED, { 'marketplace.publisherProfile': false })
    expect(button('Request verification').disabled).toBe(true)
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('without it, a waiting ask cannot be withdrawn either', () => {
    open(
      { ...LISTED, verificationRequest: { state: 'pending' } },
      { 'marketplace.publisherProfile': false },
    )
    expect(button('Withdraw request').disabled).toBe(true)
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })
})
