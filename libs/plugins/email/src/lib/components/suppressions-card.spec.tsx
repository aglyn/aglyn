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
 * The suppression list has a READER (AGL-2410).
 *
 * `hosts/{hostId}/suppressions` was written by two paths — the unsubscribe
 * handler and, since AGL-1918, the Resend webhook — and read by exactly one,
 * `campaign-send.ts`, to filter an audience. Nothing displayed it, so the gap
 * between a campaign's recipient count and what it sent was unexplained, a
 * bounce rate was unknowable, and a suppression a link prescanner caused
 * (AGL-2408 §2) was unrecoverable from inside the product.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - THE ROWS ARE THE STORED ONES, with the stored reason. A table wired to a
 *    constant, or one that labelled everything "unsubscribed", would satisfy
 *    "there is a screen" and answer none of the three questions.
 *  - AN ABSENT REASON READS AS UNSUBSCRIBED. Every entry written before
 *    AGL-2408 has no `reason`, and that is not "unknown": the webhook has
 *    stamped one since AGL-1918, so a reasonless row can only have come from
 *    somebody clicking the link.
 *  - THE REMOVE ACTUALLY DELETES, and only after a confirmation that names
 *    the reason being overridden — for a bounce the address very likely does
 *    not exist, and mailing it again is what a provider scores the domain on.
 *  - CANCELLING DELETES NOTHING. `confirm` REJECTS on cancel (AGL-950), so a
 *    handler that gated on the resolved value alone would delete on both
 *    paths and no other assertion here would notice.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deleteDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import SuppressionsCard from './suppressions-card'

/** Mutable so each case picks the rows before rendering. */
let suppressionDocs: Array<Record<string, unknown>> = []

/**
 * ONE Firestore handle for the whole file: the aggregate effect keys on it,
 * and a factory returning a fresh `{}` per render is an infinite loop.
 */
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // The Add drawer posts to a route, so the card holds a signed-in user to
  // authenticate with. A double rather than nothing: `useUser()` returning
  // undefined would throw on destructure and take every case in this file
  // with it, which is a harness failure wearing a product failure's clothes.
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: async () => 'tok' } }),
  /*
   * The table pages its own query (AGL-2501), and the SERVER decides the order.
   * The double sorts the way `orderBy('createdAt','desc')` would, so "newest
   * first" is a property of the answer rather than of a client sort the card
   * no longer performs.
   */
  usePagedCollection: () => ({
    rows: [...suppressionDocs].sort(
      (a: any, b: any) =>
        (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
    ),
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => undefined,
}))

jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({ args, where: undefined }),
  query: (base: any, ...constraints: any[]) => ({
    ...base,
    where: constraints.find((item) => item && 'field' in item) ?? base?.where,
  }),
  limit: () => undefined,
  orderBy: () => undefined,
  count: () => 'count',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  /*
   * The reason breakdown is a SERVER AGGREGATE now, not a tally of the rows on
   * screen (AGL-2501) — a chip that counted the page would read the page size
   * on a long list. The double answers from the same fixture the table is
   * answered from, so the two cannot agree by coincidence.
   */
  getAggregateFromServer: async (built: any) => {
    const predicate = built?.where
    const matching = predicate
      ? suppressionDocs.filter(
          (row: any) => row[predicate.field] === predicate.value,
        )
      : suppressionDocs
    return { data: () => ({ total: matching.length }) }
  },
  // The DELETED PATH is what the assertions read, so the double records it
  // rather than answering an opaque token: "delete was called" and "the right
  // document was deleted" are different claims, and only the second one says
  // the row on screen is the row that goes.
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

/** Mutable so a case can make the operator CANCEL. */
const confirmation = { accepted: true, seen: [] as Array<Record<string, any>> }

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn((options: Record<string, any>) => {
      confirmation.seen.push(options)
      // Modelled EXACTLY: `confirm` resolves with no value and REJECTS on
      // cancel. A double that resolved `false` instead would make the
      // cancel case pass against a handler that cannot cancel (AGL-950).
      return confirmation.accepted
        ? Promise.resolve(undefined)
        : Promise.reject(new Error('cancelled'))
    }),
  }),
}))

const DAY = 1_800_000_000

beforeEach(() => {
  jest.clearAllMocks()
  confirmation.accepted = true
  confirmation.seen = []
  suppressionDocs = [
    // `createdAt` on every row, because both writers stamp it when the
    // document is created — which is why the list can be ordered on it
    // without dropping anyone (AGL-2501). `suppressedAt` is the restamp.
    {
      $id: 'hash-a',
      email: 'dana@example.com',
      reason: 'bounce',
      createdAt: { seconds: DAY },
      suppressedAt: { seconds: DAY + 172_800 },
    },
    {
      $id: 'hash-b',
      email: 'sam@example.com',
      reason: 'complaint',
      createdAt: { seconds: DAY + 86_400 },
      suppressedAt: { seconds: DAY + 86_400 },
    },
    // Written before AGL-2408: the unsubscribe handler stored no reason.
    {
      $id: 'hash-c',
      email: 'lee@example.com',
      createdAt: { seconds: DAY - 86_400 },
    },
  ]
})

describe('SuppressionsCard (AGL-2410)', () => {
  it('names every suppressed address and why', async () => {
    render(<SuppressionsCard hostId="host-1" />)

    expect(screen.getByText('dana@example.com')).toBeTruthy()
    expect(screen.getByText('sam@example.com')).toBeTruthy()
    expect(screen.getByText('lee@example.com')).toBeTruthy()
    // The three questions the issue lists, answerable off this screen.
    expect(screen.getAllByText('Bounced').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Marked as spam').length).toBeGreaterThan(0)
    // The reasonless legacy row, read as an unsubscribe rather than shown as
    // blank or "unknown".
    expect(screen.getAllByText('Unsubscribed').length).toBeGreaterThan(0)
  })

  it('breaks the count down by reason', async () => {
    render(<SuppressionsCard hostId="host-1" />)

    // "My campaign says 500 recipients and 480 sent — who were the other
    // 20?" begins here. Awaited, because the breakdown is a server aggregate
    // rather than a tally of the rendered rows: it cannot resolve in the same
    // tick as the mount that asked for it, and a synchronous assertion would
    // read the "could not read the breakdown" state instead.
    await waitFor(() => expect(screen.getByText('Bounced: 1')).toBeTruthy())
    expect(screen.getByText('Marked as spam: 1')).toBeTruthy()
    // The reasonless legacy row, counted as the REMAINDER — an equality on
    // `reason` would exclude it, which is the same field-presence trap as
    // ordering on a field a writer can omit.
    expect(screen.getByText('Unsubscribed: 1')).toBeTruthy()
  })

  it('counts a hand-added entry as its own reason, not as an unsubscribe', async () => {
    // Unsubscribes are the REMAINDER — total minus the reasons counted
    // explicitly — so every reason that gets its own writer has to get its
    // own aggregate too. A `manual` row left out of that subtraction is
    // reported as somebody who clicked a link they never saw, and the merchant
    // reading the chip cannot tell the two apart.
    suppressionDocs = [
      ...suppressionDocs,
      {
        $id: 'hash-d',
        email: 'kim@example.com',
        reason: 'manual',
        createdAt: { seconds: DAY + 200_000 },
        suppressedAt: { seconds: DAY + 200_000 },
      },
    ]
    render(<SuppressionsCard hostId="host-1" />)

    await waitFor(() =>
      expect(screen.getByText('Added by hand: 1')).toBeTruthy(),
    )
    expect(screen.getByText('Unsubscribed: 1')).toBeTruthy()
  })

  it('says so plainly when nobody is suppressed', () => {
    // The negative control. An empty table with a chip row reading nothing is
    // indistinguishable from a broken read.
    suppressionDocs = []
    render(<SuppressionsCard hostId="host-1" />)

    expect(screen.getByText(/Nobody is suppressed/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('deletes the row the operator pressed Remove on', async () => {
    render(<SuppressionsCard hostId="host-1" />)

    // Newest first, so `sam` is row one and `dana` row two.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])

    await waitFor(() => expect(deleteDoc).toHaveBeenCalledTimes(1))
    expect((deleteDoc as jest.Mock).mock.calls[0][0]).toEqual({
      path: 'hosts/host-1/suppressions/hash-a',
    })
  })

  it('confirms with the REASON, not a generic “are you sure”', async () => {
    render(<SuppressionsCard hostId="host-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])

    await waitFor(() => expect(confirmation.seen).toHaveLength(1))
    const [options] = confirmation.seen
    expect(options.description).toEqual(
      expect.stringContaining('dana@example.com'),
    )
    // A bounce means the mailbox very likely does not exist; re-mailing it is
    // what a provider scores the sending domain on, so the dialog has to say
    // which suppression is being overridden.
    expect(options.description).toMatch(/bounced permanently/i)
    expect(options.description).toMatch(/email it again/i)
  })

  it('deletes NOTHING when the operator cancels', async () => {
    confirmation.accepted = false
    render(<SuppressionsCard hostId="host-1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])

    await waitFor(() => expect(confirmation.seen).toHaveLength(1))
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar).not.toHaveBeenCalled()
  })

  it('shows a hashed legacy row honestly instead of 64 hex characters', () => {
    // Entries are keyed by `sha256(email)` because addresses are PII. A row
    // written before the address was stored beside it has only the hash,
    // which tells a merchant nothing.
    suppressionDocs = [{ $id: 'a'.repeat(64), createdAt: { seconds: DAY } }]
    render(<SuppressionsCard hostId="host-1" />)

    expect(screen.getByText('(address not recorded)')).toBeTruthy()
    expect(screen.queryByText('a'.repeat(64))).toBeNull()
  })
})
