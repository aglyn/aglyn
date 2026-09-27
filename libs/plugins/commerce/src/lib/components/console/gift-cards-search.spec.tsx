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
 * The Gift cards card's search is its QUERY's (AGL-3321).
 *
 * It used to match the code and the address over the page in front of the
 * merchant, and said so: "the search reads the page in front of you". A card
 * issued three pages ago was unfindable by its own code. `useListQuery` is
 * the contract's double here, which runs the real plan and answers it the
 * way Firestore would — so the one card this file looks for sits past the
 * first page, and a card that matched over its loaded rows would miss it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { giftCardSearchTokens } from '../../model/gift-card-search'
import { GIFT_CARD_LIST_QUERY, GiftCardsCard } from './gift-cards-card.component'

const PAGE = 10
const NOW = 1_800_000_000_000

/** The card searched for: a real code's shape, past the first page. */
const TARGET = 'GC-5EED00C0FFEE'

/** Newest first; the one card with an address is far past the first page. */
const mockCards = Array.from({ length: 45 }, (_, index) => {
  const code = index === 37 ? TARGET : `GC-${String(index).padStart(12, '0')}`
  const recipientEmail = index === 37 ? 'dana.gift@example.com' : null
  return {
    $id: code,
    initialCents: 5000,
    balanceCents: 5000,
    recipientEmail,
    orderId: null,
    searchTokens: giftCardSearchTokens(code, recipientEmail),
    createdAtMs: NOW - index * 1000,
  }
})

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) => useListQueryDouble(() => mockCards, options),
  }
})
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (ref: unknown) => ref,
  where: () => undefined,
  getAggregateFromServer: async () => ({
    data: () => ({ outstandingCents: 0, liveCount: 0, issuedCount: 0 }),
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-owner' } }),
}))
jest.mock('./entitlement-gate.component', () => ({
  EntitlementGatedCard: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))

const shownCodes = () =>
  Array.from(document.querySelectorAll('p, span'))
    .map((node) => node.textContent ?? '')
    .filter((text) => /^GC-[0-9A-F]{12}$/.test(text))

const typeSearch = (value: string) =>
  fireEvent.change(screen.getByLabelText('Search by code or email'), { target: { value } })

describe('the gift card search is on the query (AGL-3321)', () => {
  it('THE CONTROL: the card searched for is not on the first page', () => {
    render(<GiftCardsCard hostId="host-1" />)
    expect(shownCodes()).toHaveLength(PAGE)
    expect(shownCodes()).not.toContain(TARGET)
  })

  it('finds a card by the address it was sent to, past the first page', async () => {
    render(<GiftCardsCard hostId="host-1" />)
    typeSearch('dana')
    await waitFor(() => expect(shownCodes()).toEqual([TARGET]))
    expect(lastListQueryPlan()?.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'dana' },
    ])
  })

  it.each(['gc-5eed', '5EED00', TARGET])('finds a card by its code, or part of it: %s', async (typed) => {
    render(<GiftCardsCard hostId="host-1" />)
    typeSearch(typed)
    await waitFor(() => expect(shownCodes()).toEqual([TARGET]))
  })

  it('says a miss plainly, without blaming the page', async () => {
    render(<GiftCardsCard hostId="host-1" />)
    typeSearch('nobody')
    expect(await screen.findByText('No gift card matches that code or email.')).toBeTruthy()
  })
})

describe('the search has its index (AGL-3321)', () => {
  const indexFile = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'),
      'utf8',
    ),
  )
  it('needs one composite, declared at collection scope', () => {
    const needed = listQueryIndexes(GIFT_CARD_LIST_QUERY)
    expect(needed).toEqual([
      {
        fields: [
          { fieldPath: 'searchTokens', arrayConfig: 'CONTAINS' },
          { fieldPath: 'createdAtMs', order: 'DESCENDING' },
        ],
      },
    ])
    expect(missingListQueryIndexes(indexFile, 'giftCards', needed)).toEqual([])
  })
})
