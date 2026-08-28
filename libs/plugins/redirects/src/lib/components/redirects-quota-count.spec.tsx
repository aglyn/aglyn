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
 * The redirects console counts what the ENFORCING route counts.
 *
 * `hosts/{id}/redirects` is read on this page as an unordered `limit(200)`
 * window and then filtered to drop soft-deleted rows, and that filtered length
 * was feeding both `checkQuota('redirectsPerHost')` and the readout beside it.
 * `app/api/hosts/resources` counts the collection plainly —
 * `collectionRef.count()`, every document, soft-deleted ones included — so the
 * two disagreed on both counts at once: a rule deleted in this console still
 * occupies a slot on the server, and a site past 200 rules has rows the window
 * never saw.
 *
 * The visible effect is the worst kind. The page shows room, the author fills
 * in the form, and the save is refused by a server counting something else.
 *
 * The fixture is the disagreement: a window holding ONE live rule, over a
 * collection the server counts TWENTY-FIVE of — a plan whose cap is exactly
 * twenty-five. The old code read "1 of 25" and opened the form; the enforcer
 * would have refused it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { checkQuota } from '@aglyn/aglyn'
import { getCountFromServer } from 'firebase/firestore'
import type { ReactNode } from 'react'
import RedirectsConsolePage from './redirects-console-page'

/**
 * One LIVE rule on screen, one soft-deleted beside it. The visible length is
 * 1; the server counts every document in the collection.
 */
const redirectDocs = [
  {
    $id: 'red-1',
    source: '/old-pricing',
    destination: '/pricing',
    statusCode: 301,
    kind: 'exact',
    priority: 100,
    enabled: true,
  },
  {
    $id: 'red-deleted',
    source: '/gone',
    destination: '/home',
    statusCode: 302,
    kind: 'exact',
    priority: 100,
    enabled: false,
    // Soft-deleted: hidden here, still counted there.
    deletedAt: { toMillis: () => 0 },
  },
]

/** What the enforcing route would count. Moved per test. */
let serverCount = 25

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: redirectDocs,
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({
    data: { $id: 'host-1', screens: {} },
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'red-new' }),
  useUser: () => ({ data: { uid: 'uid-editor' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => ({}) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  // The aggregation the enforcing route uses. Recorded so the collection it
  // counts can be asserted, not just the number it returns.
  getCountFromServer: jest.fn(async () => ({ data: () => ({ count: serverCount }) })),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

/**
 * Starter, whose `redirectsPerHost` is 25 — read from the real plan table
 * rather than asserted here, so a repriced plan moves this fixture with it
 * instead of leaving it testing a cap nobody sells.
 */
const CAP = checkQuota({ plan: 'starter' } as never, 'redirectsPerHost', 0).limit
const ORG = { plan: 'starter' } as never

beforeEach(() => {
  jest.clearAllMocks()
  serverCount = CAP
  ;(getCountFromServer as jest.Mock).mockImplementation(async () => ({
    data: () => ({ count: serverCount }),
  }))
})

const renderPage = () =>
  render(<RedirectsConsolePage hostId="host-1" entitled org={ORG} />)

const addRedirect = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Add redirect' }))

/**
 * Wait for the count to land before pressing Add.
 *
 * The gate reads the polled count, so before it arrives there is no number to
 * refuse on and the add is deliberately let through — the route is the
 * enforcer, and blocking on a figure we do not have yet would refuse authors
 * who are inside their cap. Waiting here is therefore part of the case under
 * test, not test hygiene: it is the state in which the gate has an answer.
 */
const countLanded = () =>
  waitFor(() => expect(getCountFromServer).toHaveBeenCalled())

describe('the redirects console counts what the server enforces on', () => {
  /**
   * The CONTROL, and it is not decoration.
   *
   * Every other assertion here is "the author was refused", and a page that
   * refused every add would satisfy them all while being useless. This is the
   * reading that proves the gate opens when there IS room — and that it opens
   * on the SERVER's number, from a collection with rows this window cannot
   * see.
   */
  it('CONTROL: opens the form when the server says there is room', async () => {
    serverCount = 3
    renderPage()
    await countLanded()
    addRedirect()

    await waitFor(() => expect(screen.queryByLabelText('To')).not.toBeNull())
    expect(enqueueSnackbar).not.toHaveBeenCalled()
  })

  /*
   * The bug, as the author met it: one rule on screen, a full collection on
   * the server. The old code read the visible length and waved them through.
   */
  it('refuses an add the enforcing route would refuse', async () => {
    serverCount = CAP
    renderPage()
    await countLanded()
    addRedirect()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/limit reached/i),
    )
    // No form: the point is to spare the author filling one in.
    expect(screen.queryByLabelText('To')).toBeNull()
  })

  it('counts the redirects collection, not the rows on screen', async () => {
    renderPage()
    await waitFor(() => expect(getCountFromServer).toHaveBeenCalled())
    // The mocked `collection()` answers with its last segment, so this asserts
    // WHICH collection the count was taken over.
    expect(getCountFromServer).toHaveBeenCalledWith('redirects')
  })

  /*
   * The readout and the gate read one number. They were the same expression
   * before — the visible length — which is precisely how they agreed with each
   * other and disagreed with the server.
   */
  it('shows the enforcing count in the readout, not the visible rows', async () => {
    serverCount = CAP
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(new RegExp(String(CAP)))).toBeTruthy(),
    )
    // `1` is the visible-row count the readout used to show.
    expect(screen.queryByText(`1 of ${CAP} redirects`)).toBeNull()
  })
})
