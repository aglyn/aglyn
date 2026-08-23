/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The Licences tab's presentation (AGL-2486).
 *
 * The panel shipped as two bare headings with a sentence under each, on a
 * page where every sibling tab is built from cards — so the tab read as
 * unfinished rather than empty. Cards are the easy half; the half worth a
 * test is that the sentences under them are GATED. "You have not bought
 * anything" is a claim about someone's purchase history, and a refused or
 * unfinished read supports no such claim (AGL-1066) — which matters more
 * here than on most lists, because the conclusion this tab invites is
 * "buy it again".
 */

import { render, screen } from '@testing-library/react'
import OrgLicencesPanel from './org-licences-panel.component'

interface FakeRead {
  data: any[]
  status: string
  serverDenied: boolean
}

const EMPTY_LOADED: FakeRead = {
  data: [],
  status: 'success',
  serverDenied: false,
}

/**
 * Queried in declaration order: org licences, then the buyer's own, then the
 * catalogue used for display names.
 */
const mockReads: FakeRead[] = []
let mockCall = 0

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreCollection: () =>
    mockReads[mockCall++] ?? { data: [], status: 'success', serverDenied: false },
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ orgs: [] }),
}))

const renderPanel = (orgRead: FakeRead, mineRead: FakeRead) => {
  mockReads.length = 0
  mockReads.push(orgRead, mineRead, EMPTY_LOADED)
  mockCall = 0
  return render(<OrgLicencesPanel orgId="org1" orgSlug="acme" />)
}

describe('OrgLicencesPanel presents its empty tab like the rest of the console', () => {
  it('renders both zero-states on cards once both reads have SETTLED', () => {
    const { container } = renderPanel(EMPTY_LOADED, EMPTY_LOADED)

    expect(screen.getByText(/this workspace holds no licences/i)).toBeTruthy()
    expect(screen.getByText(/you have not bought anything yet/i)).toBeTruthy()
    // The complaint in one assertion: card surfaces, not loose text. Two
    // zero-states plus nothing else on this tab that is a card.
    expect(container.querySelectorAll('.MuiCard-root')).toHaveLength(2)
  })

  it('makes NEITHER claim while a read is still in flight', () => {
    renderPanel(
      { data: [], status: 'loading', serverDenied: false },
      { data: [], status: 'loading', serverDenied: false },
    )

    expect(screen.queryByText(/holds no licences/i)).toBeNull()
    expect(screen.queryByText(/have not bought anything/i)).toBeNull()
  })

  it('makes NEITHER claim when the listen was refused', () => {
    // The shape that matters most on this tab: a session denying every
    // server read leaves the cache painting an empty list, and `status` for
    // such a listen still reads `success`. Only `serverDenied` says so.
    renderPanel(
      { data: [], status: 'success', serverDenied: true },
      { data: [], status: 'success', serverDenied: true },
    )

    expect(screen.queryByText(/holds no licences/i)).toBeNull()
    expect(screen.queryByText(/have not bought anything/i)).toBeNull()
    expect(screen.getAllByText(/could not be loaded/i).length).toBe(2)
  })

  it('gates the two lists SEPARATELY — they are two different reads', () => {
    // The org read settled empty; the buyer's own is still coming. Only the
    // settled one may speak.
    renderPanel(EMPTY_LOADED, {
      data: [],
      status: 'loading',
      serverDenied: false,
    })

    expect(screen.getByText(/this workspace holds no licences/i)).toBeTruthy()
    expect(screen.queryByText(/have not bought anything/i)).toBeNull()
  })

  it('puts real rows on a card with its heading', () => {
    renderPanel(
      {
        data: [
          {
            $id: 'p1',
            listingId: 'l1',
            buyerUid: 'u1',
            buyerOrgId: 'org1',
            amountCents: 2500,
            taxCents: 0,
          },
        ],
        status: 'success',
        serverDenied: false,
      },
      EMPTY_LOADED,
    )

    expect(screen.getByText('This workspace')).toBeTruthy()
    expect(screen.getByText('$25.00')).toBeTruthy()
    expect(screen.getByText(/you have not bought anything yet/i)).toBeTruthy()
  })

  it('never lists a refunded purchase as a licence', () => {
    // AGL-1546, re-pinned because the zero-state now depends on the SAME
    // filtered array: a refunded-only workspace must reach "holds no
    // licences", not a card with a row the install route will refuse.
    renderPanel(
      {
        data: [
          {
            $id: 'p1',
            listingId: 'l1',
            buyerUid: 'u1',
            buyerOrgId: 'org1',
            amountCents: 2500,
            refundedAt: { seconds: 1 },
          },
        ],
        status: 'success',
        serverDenied: false,
      },
      EMPTY_LOADED,
    )

    expect(screen.queryByText('$25.00')).toBeNull()
    expect(screen.getByText(/this workspace holds no licences/i)).toBeTruthy()
  })
})
